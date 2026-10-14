import { test, expect } from '@playwright/test';
import { installPlugin, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import { NC_URL, PLUGIN, admin, connectThroughLoginFlow, forgetAccount, openSettings, pluginFrame } from './nc-helpers.mjs';

// Connect with Login Flow v2 against the Nextcloud container, switch to
// another sign-in, then disconnect.
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

      const frame = await openSettings(page, theme);
      await expect(frame.getByRole('button', { name: 'Connect Nextcloud' })).toBeVisible();
      await expect(frame.getByText('Server: localhost:18080')).toBeVisible();
      await shoot(page, PLUGIN, 'settings-disconnected', theme);

      await connectThroughLoginFlow(page, frame);
      // The display name comes from Nextcloud's user API, called with the
      // captured app password. It is named as the Nextcloud account, so it
      // can't be taken for the mail account.
      const connected = frame.getByText('Connected to Nextcloud at localhost:18080 as Alice Example (alice).');
      await expect(connected).toBeVisible({ timeout: 30_000 });
      await expect(frame.getByText(/not necessarily your mail account/)).toBeVisible();
      await shoot(page, PLUGIN, 'settings-connected', theme);

      // "Use another Nextcloud account" disconnects and signs in again.
      await connectThroughLoginFlow(page, frame, 'Use another Nextcloud account');
      await expect(connected).toBeVisible({ timeout: 30_000 });

      await frame.getByRole('button', { name: 'Disconnect' }).click();
      await expect(frame.getByRole('button', { name: 'Connect Nextcloud' })).toBeVisible();
      const accounts = await page.evaluate(async () => (await (await fetch('/api/plugin-secrets?plugin=nextcloud')).json()).credentials);
      expect(accounts).toEqual([]);

      // Without an account the Nextcloud page says so in the middle and offers to connect.
      await page.getByRole('button', { name: 'Back to Mail' }).click();
      await page.getByRole('link', { name: 'Nextcloud' }).click();
      await expect(page).toHaveURL(/\/apps\/nextcloud\/files/);
      // The settings frame says the same thing in a row; the page's empty state is the only h3 with it.
      const pageFrame = await pluginFrame(page, "h3:has-text(\"Nextcloud isn't connected\")");
      await expect(pageFrame.getByRole('button', { name: 'Connect Nextcloud' })).toBeVisible();
      await shoot(page, PLUGIN, 'files-page-disconnected', theme);
    });
  }
});
