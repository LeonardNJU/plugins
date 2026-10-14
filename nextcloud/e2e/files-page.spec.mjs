import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { installPlugin, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin, shoot, REPO } from '../../e2e/helpers.mjs';
import { NC_URL, PLUGIN, admin, davPath, deleteShares, ensureConnected, nameNewFolder, ncFetch, pluginFrame } from './nc-helpers.mjs';

// The Nextcloud page: upload (paused and resumed), share, download (a
// streamed 30 MB file) and attach to a new message.
const SCRATCH = path.resolve(REPO, '..', 'plugin-audit-data', 'scratch-nextcloud');
const MB = 1024 * 1024;

test.describe.serial('Nextcloud page', () => {
  let api;
  const folder = `E2E page ${Date.now()}`;
  const name = 'page-upload.bin';
  const file = path.join(SCRATCH, name);
  test.beforeAll(async () => {
    test.setTimeout(30 * 60_000);
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(30 * MB));
    api = await admin();
    await installPlugin(api, PLUGIN);
    await setPluginConfig(api, PLUGIN, 'serverUrl', NC_URL);
  });
  test.afterAll(async () => {
    fs.rmSync(file, { force: true });
    await deleteShares(`/${folder}/${name}`).catch(() => {});
    await ncFetch(davPath(`/${folder}`), { method: 'DELETE' }).catch(() => {});
    if (api) await uninstallPlugin(api, PLUGIN);
  });

  async function openPage(page, theme) {
    await preparePage(page, { theme });
    await signIn(page);
    await waitForPlugin(page, PLUGIN);
    await ensureConnected(page, theme);
    await page.getByRole('link', { name: 'Nextcloud' }).click();
    await expect(page).toHaveURL(/\/apps\/nextcloud\/files/);
    return pluginFrame(page, 'button:has-text("Upload")');
  }

  test('upload, share, download and attach (light)', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const frame = await openPage(page, 'light');
    await frame.getByRole('button', { name: 'New folder' }).click();
    await nameNewFolder(page, folder);
    await expect(frame.getByRole('button', { name: folder, exact: true })).toHaveAttribute('aria-current', 'page');

    await frame.locator('[data-testid="nc-upload-input"]').setInputFiles(file);
    const upload = frame.getByRole('listitem').filter({ hasText: name });
    await upload.getByRole('button', { name: 'Cancel' }).click();
    await expect(upload.getByText('Paused', { exact: true })).toBeVisible();
    await upload.getByRole('button', { name: 'Resume' }).click();
    await expect(upload.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 5 * 60_000 });
    const stat = await ncFetch(davPath(`/${folder}/${name}`), { method: 'PROPFIND', headers: { Depth: '0' } });
    expect(await stat.text()).toContain(`<d:getcontentlength>${30 * MB}</d:getcontentlength>`);
    // Done uploads can be dismissed; the file stays in the list.
    await upload.filter({ hasText: 'Uploaded' }).getByRole('button', { name: 'Remove' }).click();
    await expect(frame.getByText('Uploaded', { exact: true })).toBeHidden();

    await frame.getByRole('listitem').filter({ hasText: name }).click();
    await frame.getByRole('button', { name: 'Share link' }).click();
    const shareDialog = page.getByRole('dialog').filter({ hasText: `Share ${name}` });
    await expect(shareDialog).toBeVisible();
    await shareDialog.getByRole('button', { name: 'Create link' }).click();
    const shareFrame = await pluginFrame(page, 'text=The link is ready. Copy it from here:');
    const link = shareFrame.getByRole('textbox', { name: 'Share link' });
    await expect(link).toHaveValue(/\/s\//);
    const shares = await (await ncFetch(`/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent(`/${folder}/${name}`)}`)).json();
    expect(shares.ocs.data.map((s) => s.url)).toContain(await link.inputValue());
    await shoot(page, PLUGIN, 'share-link', 'light');
    await shareDialog.locator('[data-plugin-dialog-buttons]').getByRole('button', { name: 'Close' }).click();
    await expect(shareDialog).toBeHidden();
    await shoot(page, PLUGIN, 'files-page', 'light');

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await frame.getByRole('button', { name: 'Download' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(name);
    const saved = path.join(SCRATCH, `downloaded-${name}`);
    await download.saveAs(saved);
    expect(fs.statSync(saved).size).toBe(30 * MB);
    expect(crypto.createHash('sha256').update(fs.readFileSync(saved)).digest('hex'))
      .toBe(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    fs.rmSync(saved, { force: true });

    await frame.getByRole('button', { name: 'Attach to new message' }).click();
    await expect(page.getByRole('heading', { name: 'New Message' })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Discard' }).click();
  });

  test('the page in dark mode and on a phone', async ({ page }) => {
    const frame = await openPage(page, 'dark');
    await frame.getByRole('listitem').filter({ hasText: 'Documents' }).click();
    await frame.getByRole('listitem').filter({ hasText: 'Report 2026.pdf' }).click();
    await expect(frame.getByRole('button', { name: 'Attach to new message' })).toBeVisible();
    await shoot(page, PLUGIN, 'files-page', 'dark');

    // The account button names the Nextcloud account, with a way to use another one.
    await frame.getByRole('button', { name: 'Clear selection' }).click();
    await frame.getByRole('button', { name: 'Alice Example (alice)' }).click();
    const account = page.getByRole('dialog').filter({ hasText: 'Nextcloud account' });
    await expect(account.getByRole('button', { name: 'Use another Nextcloud account' })).toBeVisible();
    const accountFrame = await pluginFrame(page, 'text=Connected to Nextcloud at localhost:18080 as Alice Example (alice).');
    await expect(accountFrame.getByText(/not necessarily your mail account/)).toBeVisible();
    await shoot(page, PLUGIN, 'account', 'dark');
    await account.locator('[data-plugin-dialog-buttons]').getByRole('button', { name: 'Close' }).click();
    await expect(account).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(frame.getByRole('button', { name: 'Upload' })).toBeVisible();
    await shoot(page, PLUGIN, 'files-page-phone', 'dark');
  });
});
