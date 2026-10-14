import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { installPlugin, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin, shoot, REPO } from '../../e2e/helpers.mjs';
import { NC_URL, PLUGIN, admin, davPath, ensureConnected, ncFetch, openComposer, pluginFrame } from './nc-helpers.mjs';

// A 45 MB attachment goes to Nextcloud in chunks (with a pause and resume
// in between) and the composer gets a share link instead.
const SCRATCH = path.resolve(REPO, '..', 'plugin-audit-data', 'scratch-nextcloud');
const MB = 1024 * 1024;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe.serial('large attachments', () => {
  let api;
  const name = `big-e2e-${Date.now()}.bin`;
  const file = path.join(SCRATCH, name);
  test.beforeAll(async () => {
    test.setTimeout(30 * 60_000);
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(45 * MB));
    api = await admin();
    await installPlugin(api, PLUGIN);
    await setPluginConfig(api, PLUGIN, 'serverUrl', NC_URL);
  });
  test.afterAll(async () => {
    fs.rmSync(file, { force: true });
    await ncFetch(davPath(`/Mail attachments/${today()}/${name}`), { method: 'DELETE' }).catch(() => {});
    if (api) await uninstallPlugin(api, PLUGIN);
  });

  test('upload a large attachment to Nextcloud, pause, resume and get a link', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await preparePage(page, { theme: 'light' });
    await signIn(page);
    await waitForPlugin(page, PLUGIN);
    await ensureConnected(page, 'light');
    await openComposer(page);

    await page.locator('input[type="file"]').first().setInputFiles(file);
    const dialog = page.getByRole('dialog').filter({ hasText: 'Large attachment' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    const offer = await pluginFrame(page, 'text=Upload and add link');
    await expect(offer.getByText(new RegExp(`${name} is 45 MB`))).toBeVisible();
    await shoot(page, PLUGIN, 'large-offer', 'light');

    await offer.getByRole('button', { name: 'Upload and add link' }).click();
    await expect(offer.getByRole('progressbar')).toBeVisible();
    await offer.getByRole('button', { name: 'Cancel' }).click();
    await expect(offer.getByText('Upload paused.')).toBeVisible();
    // Chunks that made it are kept on the server for the resume.
    await offer.getByRole('button', { name: 'Resume upload' }).click();
    await expect(dialog).toBeHidden({ timeout: 5 * 60_000 });

    // The file is in Nextcloud with the full size, and the composer has the link instead of the attachment.
    const res = await ncFetch(davPath(`/Mail attachments/${today()}/${name}`), { method: 'PROPFIND', headers: { Depth: '0' } });
    expect(res.status).toBe(207);
    expect(await res.text()).toContain(`<d:getcontentlength>${45 * MB}</d:getcontentlength>`);
    await expect(page.locator('.ProseMirror, [contenteditable="true"]').first()).toContainText('Files shared with Nextcloud');
    await expect(page.locator('.ProseMirror a', { hasText: name })).toHaveAttribute('href', /\/s\//);
    await shoot(page, PLUGIN, 'large-link', 'light');
    await page.getByRole('button', { name: 'Discard' }).click();
  });
});
