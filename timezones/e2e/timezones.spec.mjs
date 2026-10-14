// End to end against the webmail at BULWARK_URL signed in to the Stalwart
// test container (alice@example.org). Installs the plugin as an admin plugin
// and removes it again afterwards.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  BASE, installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot,
} from '../../e2e/helpers.mjs';

const ID = 'timezones';

test.use({ timezoneId: 'Europe/Berlin', locale: 'en-US' });

/** The iframe of one of this plugin's slots. */
function slotFrame(page, slot) {
  return page.frameLocator(`[data-plugin-iframe-slot="${ID}:${slot}"] iframe`);
}

/** Set the plugin's user settings through Settings → Plugins (labels → values). */
async function setUserSettings(page, values) {
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('plugin:timezones:') && k.endsWith(':settingsMirror')) localStorage.removeItem(k);
  });
  await page.goto(`${BASE}/settings/plugins`, { waitUntil: 'domcontentloaded' });
  await waitForPlugin(page, ID);
  // The background has started once it wrote its settings copy; a change
  // made before that would not reach it.
  await expect.poll(() => readMirror(page), { timeout: 60_000 }).not.toBe('');
  const card = page.getByRole('button', { name: /Time zone helper.*From your administrator/s });
  if ((await card.getAttribute('aria-expanded')) !== 'true') await card.click();
  for (const [label, value] of Object.entries(values)) {
    if (typeof value === 'boolean') {
      const sw = page.getByRole('switch', { name: label });
      if ((await sw.getAttribute('aria-checked')) !== String(value)) await sw.click();
    } else {
      // Through '' first: the value may already be there (settings sync
      // between sessions), and an unchanged field sends no change.
      const field = page.getByLabel(label, { exact: true });
      await field.fill('');
      await field.fill(String(value));
    }
  }
  // Slots opened from now on start from the copy the background keeps
  // (see mirrorSettings); wait until it has the new values.
  await expect.poll(() => readMirror(page)).toContain(JSON.stringify(Object.values(values).at(-1)).slice(1, -1));
}

/** The settings copy the background keeps in the plugin's storage ('' before it started). */
function readMirror(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('plugin:timezones:') && k.endsWith(':settingsMirror'));
    return key ? localStorage.getItem(key) : '';
  });
}

/**
 * Light or dark for screenshots. The test account's appearance syncs from
 * the server and other suites use it too, so the theme follows the system
 * and the browser plays light or dark.
 */
async function useTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`${BASE}/settings/appearance`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'System', exact: true }).first().click();
}

/** Open the plugin's own page in Settings (from the Settings menu). */
async function openPluginSettingsPage(page) {
  await page.getByRole('button', { name: 'Time zone helper', exact: true }).click();
  return slotFrame(page, 'settings-section');
}

/**
 * Like adminApi() from the helpers, but with an address of its own: the
 * admin sign-in allows 5 attempts per client address in 15 minutes, and the
 * other plugin suites share 127.0.0.1 with this one. The webmail reads the
 * address from X-Forwarded-For when nothing in front sets it.
 */
async function adminApi() {
  const password = process.env.BULWARK_ADMIN_PASSWORD;
  if (!password) throw new Error('Set BULWARK_ADMIN_PASSWORD to the webmail admin password');
  const ip = `10.${(Date.now() >> 8) & 255}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
  const api = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Forwarded-For': ip } });
  const res = await api.post('/api/admin/auth', { data: { password } });
  if (!res.ok()) throw new Error(`Admin sign-in failed: HTTP ${res.status()} ${await res.text()}`);
  return api;
}

let admin;

test.beforeAll(async () => {
  admin = await adminApi();
  await installPlugin(admin, ID);
});

test.afterAll(async () => {
  await uninstallPlugin(admin, ID);
});

for (const theme of ['light', 'dark']) {
  test(`settings page shows the favourites as understood (${theme})`, async ({ page }) => {
    await preparePage(page, { theme });
    await signIn(page);
    await waitForPlugin(page, ID);
    await useTheme(page, theme);
    await setUserSettings(page, { 'Favourite time zones': 'New York, Tokio, Asia/Tokyo', 'Your time zone': 'Europe/Berlin' });
    const frame = await openPluginSettingsPage(page);
    await expect(frame.locator('[data-tz="favourites"]')).toContainText('America/New_York');
    await expect(frame.locator('[data-tz="favourites"]')).toContainText('Asia/Tokyo');
    await expect(frame.locator('[data-tz="unknown"]')).toContainText('Tokio');
    await expect(frame.getByText('Europe/Berlin')).toBeVisible();
    // A zone for a person, added on the same page, is listed and can be removed.
    await frame.getByRole('button', { name: 'Add a person' }).click();
    await frame.getByLabel('Email address').fill('Bob@Example.org');
    await frame.getByLabel('Time zone', { exact: true }).fill('Chicago');
    await frame.getByRole('button', { name: 'Save' }).click();
    await expect(frame.locator('[data-tz="people"]')).toContainText('bob@example.org');
    await expect(frame.locator('[data-tz="people"]')).toContainText('Chicago');
    await shoot(page, ID, 'settings', theme);
  });
}
