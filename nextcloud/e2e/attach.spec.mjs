import { test, expect } from '@playwright/test';
import { installPlugin, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import {
  NC_URL, PLUGIN, admin, deleteShares, ensureConnected, findMail, ncFetch, openComposer, pluginFrame,
} from './nc-helpers.mjs';

// The composer's Nextcloud button against the Nextcloud container: attach a
// real copy of a file, and send a share link that Nextcloud really created.
test.describe.serial('attach from Nextcloud', () => {
  let api;
  test.beforeAll(async () => {
    test.setTimeout(30 * 60_000);
    api = await admin();
    await installPlugin(api, PLUGIN);
    await setPluginConfig(api, PLUGIN, 'serverUrl', NC_URL);
  });
  test.afterAll(async () => {
    await deleteShares('/Photos/blue.png').catch(() => {});
    if (api) await uninstallPlugin(api, PLUGIN);
  });

  for (const theme of ['light', 'dark']) {
    test(`attach a copy and send a share link (${theme})`, async ({ page }) => {
      await preparePage(page, { theme });
      await signIn(page);
      await waitForPlugin(page, PLUGIN);
      await ensureConnected(page, theme);

      // 1. Attach a copy of Documents/Report 2026.pdf.
      let button = await openComposer(page);
      await button.getByRole('button', { name: 'Nextcloud' }).click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Attach from Nextcloud' });
      await expect(dialog).toBeVisible();
      let picker = await pluginFrame(page, 'text=All files');
      await picker.locator('button.nc-item', { hasText: 'Documents' }).click();
      await picker.locator('button.nc-item', { hasText: 'Report 2026.pdf' }).click();
      await expect(picker.getByText(/Selected: 1/)).toBeVisible();
      await shoot(page, PLUGIN, 'picker', theme);
      await picker.getByRole('button', { name: 'Attach copies' }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await expect(page.getByText('Report 2026.pdf').first()).toBeVisible();

      // 2. Search, pick Photos/blue.png and share it as a link with a password.
      button = await pluginFrame(page, 'button[title="Attach files from Nextcloud or share them as links"]');
      await button.getByRole('button', { name: 'Nextcloud' }).click();
      picker = await pluginFrame(page, 'text=All files');
      await picker.getByRole('searchbox').fill('blue');
      await picker.getByRole('button', { name: 'Search', exact: true }).click();
      await picker.locator('button.nc-item', { hasText: 'blue.png' }).click();
      await picker.getByRole('button', { name: 'Share as link…' }).click();
      await picker.getByLabel('Protect the link with a password').check();
      await expect(picker.getByLabel('Password', { exact: true })).not.toHaveValue('');
      const password = await picker.getByLabel('Password', { exact: true }).inputValue();
      await shoot(page, PLUGIN, 'share-options', theme);
      await picker.getByRole('button', { name: 'Add links' }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect(button.getByText('blue.png')).toBeVisible();
      await shoot(page, PLUGIN, 'composer-links', theme);

      const shares = await ncFetch(`/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent('/Photos/blue.png')}`).then((r) => r.json());
      const link = shares.ocs.data.find((s) => s.share_type === 3);
      expect(link?.password).toBeTruthy();

      // 3. Send it to alice herself; the sent message has the attachment and the link.
      const subject = `Nextcloud e2e ${theme} ${Date.now()}`;
      await page.getByRole('combobox', { name: 'Recipient email addresses' }).fill('alice@example.org');
      await page.getByRole('combobox', { name: 'Recipient email addresses' }).press('Enter');
      await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const mail = await findMail(subject);
      expect(mail.attachments.map((a) => a.name)).toContain('Report 2026.pdf');
      expect(mail.allText).toContain('Files shared with Nextcloud');
      expect(mail.allText).toContain(link.url);
      // The password stays out of the message unless the user ticks the box.
      expect(mail.allText).not.toContain(password);
      await deleteShares('/Photos/blue.png');
    });
  }
});
