import { test, expect } from '@playwright/test';
import { installPlugin, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import {
  NC_URL, PLUGIN, admin, deleteShares, ensureConnected, findMail, ncFetch, openComposer, openPicker,
} from './nc-helpers.mjs';

// Attach > From Nextcloud against the Nextcloud container: attach a real
// copy of a file, and send a share link that Nextcloud really created.
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
      await openComposer(page);
      let { dialog, picker } = await openPicker(page, { shot: () => shoot(page, PLUGIN, 'attach-menu', theme) });
      let frame = await picker();
      await frame.getByRole('listitem').filter({ hasText: 'Documents' }).click();
      await frame.getByRole('listitem').filter({ hasText: 'Report 2026.pdf' }).click();
      await expect(frame.getByText(/Selected: 1/)).toBeVisible();
      await shoot(page, PLUGIN, 'picker', theme);
      await dialog.getByRole('button', { name: 'Attach copies' }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await expect(page.getByText('Report 2026.pdf').first()).toBeVisible();

      // 2. Search, pick Photos/blue.png and share it as a link with a password.
      ({ dialog, picker } = await openPicker(page));
      frame = await picker();
      await frame.getByRole('searchbox').fill('blue');
      await frame.getByRole('listitem').filter({ hasText: 'blue.png' }).click();
      await dialog.getByRole('button', { name: 'Share as link…' }).click();
      await frame.getByRole('checkbox', { name: 'Protect the link with a password' }).click();
      await expect(frame.getByLabel('Password', { exact: true })).not.toHaveValue('');
      const password = await frame.getByLabel('Password', { exact: true }).inputValue();
      await shoot(page, PLUGIN, 'share-options', theme);
      await dialog.getByRole('button', { name: 'Add links' }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect(page.getByText('Links added to the message: 1')).toBeVisible();

      const shares = await ncFetch(`/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent('/Photos/blue.png')}`).then((r) => r.json());
      const link = shares.ocs.data.find((s) => s.share_type === 3);
      expect(link?.password).toBeTruthy();
      // The links are in the body right away, as real links, where the user can see and edit them.
      const editor = page.locator('.ProseMirror').first();
      await expect(editor).toContainText('Files shared with Nextcloud');
      await expect(editor.locator(`a[href="${link.url}"]`)).toHaveText('blue.png');
      await expect(editor).not.toContainText(password);
      await shoot(page, PLUGIN, 'links-in-message', theme);

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
