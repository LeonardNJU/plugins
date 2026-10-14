import { test, expect } from '@playwright/test';
import { installPlugin, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { NC_URL, PLUGIN, admin, connectThroughLoginFlow, forgetAccount, openSettings } from './nc-helpers.mjs';

// Connect with Login Flow v2 against the Nextcloud container, then disconnect.
test.describe.serial('connect', () => {
  let api;
  test.beforeAll(async () => {
    test.setTimeout(30 * 60_000);
    api = await admin();
    await installPlugin(api, PLUGIN);
    await setPluginConfig(api, PLUGIN, 'serverUrl', NC_URL);
  });
  test.afterAll(async () => {
    if (api) await uninstallPlugin(api, PLUGIN);
  });

  for (const theme of ['light', 'dark']) {
    test(`connect and disconnect Nextcloud from Settings (${theme})`, async ({ page }) => {
      await preparePage(page, { theme });
      await signIn(page);
      await waitForPlugin(page, PLUGIN);
      await forgetAccount(page);

      const frame = await openSettings(page);
      await expect(frame.getByRole('button', { name: 'Connect Nextcloud' })).toBeVisible();
      await expect(frame.getByText('Server: localhost:18080')).toBeVisible();
      await shoot(page, PLUGIN, 'settings-disconnected', theme);

      await connectThroughLoginFlow(page, frame);
      // The display name comes from Nextcloud's user API, called with the captured app password.
      await expect(frame.getByText(/Connected to localhost:18080 as Alice Example/)).toBeVisible({ timeout: 30_000 });
      await shoot(page, PLUGIN, 'settings-connected', theme);

      await frame.getByRole('button', { name: 'Disconnect' }).click();
      await expect(frame.getByRole('button', { name: 'Connect Nextcloud' })).toBeVisible();
      const accounts = await page.evaluate(async () => (await (await fetch('/api/plugin-secrets?plugin=nextcloud')).json()).credentials);
      expect(accounts).toEqual([]);
    });
  }
});
