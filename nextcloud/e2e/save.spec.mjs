import { test, expect } from '@playwright/test';
import { installPlugin, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { NC_URL, PLUGIN, admin, davPath, ensureConnected, nameNewFolder, ncFetch, pluginFrame } from './nc-helpers.mjs';

// "Save to Nextcloud" on a seeded attachment and on the whole message.
test.describe.serial('save to Nextcloud', () => {
  let api;
  const folder = `E2E save ${Date.now()}`;
  test.beforeAll(async () => {
    test.setTimeout(30 * 60_000);
    api = await admin();
    await installPlugin(api, PLUGIN);
    await setPluginConfig(api, PLUGIN, 'serverUrl', NC_URL);
  });
  test.afterAll(async () => {
    await ncFetch(davPath(`/${folder}`), { method: 'DELETE' }).catch(() => {});
    if (api) await uninstallPlugin(api, PLUGIN);
  });

  async function listFolder() {
    const res = await ncFetch(davPath(`/${folder}`), { method: 'PROPFIND', headers: { Depth: '1' } });
    return decodeURIComponent(await res.text());
  }

  for (const theme of ['light', 'dark']) {
    test(`save an attachment and the message (${theme})`, async ({ page }) => {
      await preparePage(page, { theme });
      await signIn(page);
      await waitForPlugin(page, PLUGIN);
      await ensureConnected(page, theme);

      // Other tests fill the inbox; search for the seeded invoice from Bob.
      await page.getByRole('combobox', { name: /Search mail/ }).fill('Invoice 2026-10 attached');
      await page.getByRole('combobox', { name: /Search mail/ }).press('Enter');
      await page.getByText('Invoice 2026-10 attached').first().click({ position: { x: 5, y: 5 } });
      // The attachment chip's size label overlaps its menu button in the current host build, so the click is dispatched.
      await page.locator('[data-attachment-plugin-menu]').first().dispatchEvent('click');
      await page.getByRole('menuitem', { name: 'Save to Nextcloud' }).click();
      const dialog = page.getByRole('dialog').filter({ hasText: /Save .* to Nextcloud/ });
      await expect(dialog).toBeVisible();
      const frame = await pluginFrame(page, 'text=/Choose a folder for invoice/');
      if (theme === 'light') {
        await frame.getByRole('button', { name: 'New folder' }).click();
        await nameNewFolder(page, folder);
      } else {
        await frame.getByRole('listitem').filter({ hasText: folder }).click();
      }
      await expect(frame.getByRole('button', { name: folder, exact: true })).toHaveAttribute('aria-current', 'page');
      await shoot(page, PLUGIN, 'save-folder', theme);
      await dialog.getByRole('button', { name: 'Save here' }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await expect(page.getByText(`Saved to Nextcloud: /${folder}/invoice-2026-10`)).toBeVisible();
      expect(await listFolder()).toMatch(/invoice-2026-10[^<]*\.pdf/);

      // The whole message as .eml, from the reader toolbar (or its More menu).
      const direct = page.getByRole('button', { name: 'Save message to Nextcloud' });
      if (await direct.count()) await direct.first().click();
      else {
        await page.getByRole('button', { name: /more/i }).first().click();
        await page.getByRole('menuitem', { name: 'Save message to Nextcloud' }).click();
      }
      const frame2 = await pluginFrame(page, 'text=/Choose a folder for .*\.eml/');
      await expect(frame2.getByText(/Choose a folder for .*\.eml/)).toBeVisible();
      // The last folder is remembered.
      await expect(frame2.getByRole('button', { name: folder, exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('dialog').filter({ hasText: 'Save the message to Nextcloud' }).getByRole('button', { name: 'Save here' }).click();
      await expect(page.getByText(/Saved to Nextcloud: .*\.eml/)).toBeVisible({ timeout: 60_000 });
      const listing = await listFolder();
      expect(listing).toMatch(/Invoice 2026-10 attached[^<]*\.eml/);
    });
  }
});
