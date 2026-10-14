// End to end against the webmail at BULWARK_URL signed in to the Stalwart
// test container (alice@example.org). Installs the plugin as an admin plugin
// and removes it again afterwards.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  BASE, installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot,
} from '../../e2e/helpers.mjs';

const ID = 'timezones';
const STALWART = process.env.STALWART_URL || 'http://localhost:18025';
const AUTH = 'Basic ' + Buffer.from('alice@example.org:test-pass-123').toString('base64');

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
  // Plugin settings sync through the server too; a reload before the change
  // got there would load the old values back.
  const synced = page.waitForEvent('console', { predicate: (m) => /Settings synced to server/.test(m.text()), timeout: 15_000 }).catch(() => {});
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
  await expect.poll(() => readMirror(page), { timeout: 60_000 }).toContain(JSON.stringify(Object.values(values).at(-1)).slice(1, -1));
  await synced;
}

/** The settings copy the background keeps in the plugin's storage ('' before it started). */
function readMirror(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('plugin:timezones:') && k.endsWith(':settingsMirror'));
    return key ? localStorage.getItem(key) : '';
  });
}

/**
 * Light or dark for screenshots, set in Settings → Appearance. The test
 * account's appearance syncs through the server and other suites change it
 * too; shootThemed checks it is still right.
 */
async function useTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`${BASE}/settings/appearance`, { waitUntil: 'domcontentloaded' });
  const synced = page.waitForEvent('console', { predicate: (m) => /Settings synced to server/.test(m.text()), timeout: 15_000 }).catch(() => {});
  await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).first().click();
  // The change goes to the server a moment later; a reload before that
  // would load the old theme back.
  await synced;
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

/**
 * installPlugin() with retries: other suites install and remove their own
 * plugins on the same webmail at the same time, and the admin plugin list
 * sometimes answers 500 or loses a concurrent change.
 */
async function installWithRetry(api) {
  for (let attempt = 1; ; attempt++) {
    try {
      await installPlugin(api, ID);
      const list = await (await api.get('/api/admin/plugins')).json();
      if ((list.plugins ?? list).some((p) => p.id === ID && p.enabled)) return;
      throw new Error('not in the plugin list after install');
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

// Retries: the shared test account's appearance can be switched by another
// suite between our setting it and the screenshot (see shootThemed).
test.describe.configure({ timeout: 300_000, retries: 2 });

/** Screenshot, but only in the theme asked for; a wrong one fails the try. */
async function shootThemed(page, name, theme) {
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  expect(dark ? 'dark' : 'light', 'theme at screenshot time').toBe(theme);
  await shoot(page, ID, name, theme);
}

test.beforeAll(async () => {
  admin = await adminApi();
  await installWithRetry(admin);
});

test.afterAll(async () => {
  await uninstallPlugin(admin, ID);
});

for (const theme of ['light', 'dark']) {
  test(`settings page shows the favourites as understood (${theme})`, async ({ page }) => {
    await preparePage(page, { theme });
    await signIn(page);
    await waitForPlugin(page, ID);
    await setUserSettings(page, { 'Favourite time zones': 'New York, Tokio, Asia/Tokyo', 'Your time zone': 'Europe/Berlin' });
    await useTheme(page, theme);
    const frame = await openPluginSettingsPage(page);
    const favourites = frame.getByRole('list', { name: 'Favourite time zones' });
    await expect(favourites).toContainText('America/New_York');
    await expect(favourites).toContainText('Asia/Tokyo');
    await expect(frame.getByRole('status').filter({ hasText: 'Not recognised: Tokio' })).toBeVisible();
    await expect(frame.getByRole('list', { name: 'Your time zone' })).toContainText('Europe/Berlin');
    // A zone for a person, added on the same page, is listed and can be removed.
    await frame.getByRole('button', { name: 'Add a person' }).click();
    await frame.getByLabel('Email address').fill('Bob@Example.org');
    await frame.getByLabel('Time zone', { exact: true }).fill('Chicago');
    await frame.getByRole('button', { name: 'Save' }).click();
    const people = frame.getByRole('list', { name: 'Time zones of people' });
    await expect(people).toContainText('bob@example.org');
    await expect(people).toContainText('Chicago');
    await shootThemed(page, 'settings', theme);
  });
}

/** Open a part of the app and wait for the plugin there. */
async function openApp(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await waitForPlugin(page, ID);
}

for (const theme of ['light', 'dark']) {
  test(`event form shows participants' local times and warns outside working hours (${theme})`, async ({ page }) => {
    await preparePage(page, { theme });
    await signIn(page);
    await waitForPlugin(page, ID);
    await setUserSettings(page, { 'Favourite time zones': 'New York', 'Your time zone': 'Europe/Berlin' });
    await useTheme(page, theme);
    await openApp(page, '/calendar');
    await page.getByRole('button', { name: 'Create event' }).click();
    await page.getByPlaceholder('Title').fill('Planning call');
    const form = page.getByRole('dialog', { name: 'Create event' });
    const startTime = form.locator('input[type="time"]').first();
    await startTime.fill('15:00');
    await expect(startTime).toHaveValue('15:00');
    await page.getByPlaceholder('Add email address or search contacts').fill('kei@example.jp');
    await page.keyboard.press('Enter');

    const frame = slotFrame(page, 'calendar-event-form');
    const zoneRow = (city) => frame.getByRole('listitem').filter({ hasText: city });
    await expect(zoneRow('New York')).toContainText('9:00');
    await expect(frame.getByText('No time zone for kei@example.jp')).toBeVisible();
    await frame.getByRole('button', { name: 'Time zone for kei@example.jp' }).click();
    await frame.getByLabel('Time zone for kei@example.jp').fill('Tokyo');
    await frame.getByRole('button', { name: 'Save' }).click();
    const tokyo = zoneRow('Tokyo');
    await expect(tokyo).toContainText('10:00');
    await expect(tokyo).toContainText('kei@example.jp');
    await expect(tokyo).toContainText('outside working hours');
    await expect(frame.getByRole('status').filter({ hasText: /Outside 8:00\sAM–8:00\sPM for kei@example\.jp \(Tokyo\)/ })).toBeVisible();

    // The form's own warnings come from the conflict check, which runs when
    // the times change.
    await form.locator('input[type="time"]').nth(1).fill('16:30');
    await expect(page.getByText(/Outside 8:00\sAM–8:00\sPM for kei@example\.jp \(Tokyo\)/)).toBeVisible();
    await page.locator('[data-plugin-slot="calendar-event-form"]').scrollIntoViewIfNeeded();
    await shootThemed(page, 'event-form', theme);
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  });
}

// ─── Reader ──────────────────────────────────────────────────

/** JMAP calls to the Stalwart container as alice. */
async function jmap(calls) {
  const api = await playwrightRequest.newContext({ extraHTTPHeaders: { Authorization: AUTH } });
  try {
    const session = await (await api.get(`${STALWART}/.well-known/jmap`)).json();
    const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
    const apiUrl = session.apiUrl.replace(/^https?:\/\/[^/]+/, STALWART);
    return await calls({ api, accountId, apiUrl });
  } finally {
    await api.dispose();
  }
}

/**
 * Put a message from bob, written at 23:40 in UTC−5, into alice's inbox.
 * Email/set rather than an upload and Email/import: the test account shares
 * Stalwart's blob upload quota with the other suites. Returns its id.
 */
async function createLateMessage(subject) {
  return jmap(async ({ api, accountId, apiUrl }) => {
    const using = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'];
    const boxes = await (await api.post(apiUrl, { data: { using, methodCalls: [['Mailbox/query', { accountId, filter: { role: 'inbox' } }, 'a']] } })).json();
    const inbox = boxes.methodResponses[0][1].ids[0];
    const email = {
      mailboxIds: { [inbox]: true },
      from: [{ name: 'Bob Example', email: 'bob@example.org' }],
      to: [{ email: 'alice@example.org' }],
      subject,
      'header:Date': ' Wed, 14 Oct 2026 23:40:00 -0500',
      bodyValues: { b: { value: 'Sorry for the late mail, can we talk tomorrow?' } },
      textBody: [{ partId: 'b', type: 'text/plain' }],
    };
    const res = await (await api.post(apiUrl, { data: { using, methodCalls: [['Email/set', { accountId, create: { m: email } }, 'b']] } })).json();
    const created = res.methodResponses[0][1].created?.m;
    if (!created) throw new Error(`Creating the message failed: ${JSON.stringify(res.methodResponses[0][1])}`);
    return created.id;
  });
}

async function destroyMessage(id) {
  await jmap(({ api, accountId, apiUrl }) => api.post(apiUrl, {
    data: { using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'], methodCalls: [['Email/set', { accountId, destroy: [id] }, 'c']] },
  }));
}

for (const theme of ['light', 'dark']) {
  test(`reader shows the sender's local time and takes a zone for them (${theme})`, async ({ page }) => {
    const subject = `Late call ${theme} ${Date.now()}`;
    const id = await createLateMessage(subject);
    try {
      await preparePage(page, { theme });
      await signIn(page);
      await waitForPlugin(page, ID);
      await setUserSettings(page, { 'Your time zone': 'Europe/Berlin' });
      await useTheme(page, theme);
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await waitForPlugin(page, ID);
      await page.getByText(subject).first().click();

      const banner = slotFrame(page, 'email-banner');
      await expect(banner.getByText(/^Sent at 11:40\sPM their time \(UTC−5\), 6:40\sAM your time$/)).toBeVisible();

      await page.getByRole('button', { name: /show details/i }).first().click();
      const details = slotFrame(page, 'email-details-section');
      await expect(details.getByText('Their time')).toBeVisible();
      await details.getByRole('button', { name: 'Set time zone' }).click();
      await details.getByLabel('Time zone for bob@example.org').fill('Chicago');
      await details.getByRole('button', { name: 'Save' }).click();
      await expect(details.getByText(/now \d{1,2}:\d\d\s[AP]M in Chicago/)).toBeVisible();
      // The banner adds the time there now, too.
      await expect(banner.getByText(/^now \d{1,2}:\d\d\s[AP]M in Chicago$/)).toBeVisible();
      // The screenshot shows the bar above the message, so close the details.
      await page.getByRole('button', { name: /hide details/i }).first().click();
      await expect(banner.getByText(/in Chicago$/)).toBeInViewport();
      await shootThemed(page, 'reader', theme);
    } finally {
      await destroyMessage(id);
    }
  });
}

// ─── Composer ────────────────────────────────────────────────

for (const theme of ['light', 'dark']) {
  test(`composer writes a time in several zones into the message (${theme})`, async ({ page }) => {
    await preparePage(page, { theme });
    await signIn(page);
    await waitForPlugin(page, ID);
    await setUserSettings(page, { 'Favourite time zones': 'New York', 'Your time zone': 'Europe/Berlin' });
    await useTheme(page, theme);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlugin(page, ID);
    await page.getByRole('button', { name: /compose|new message/i }).first().click();

    // No plugin row in the composer any more: the entry is in Options.
    await expect(page.locator(`[data-plugin-iframe-slot="${ID}:composer-toolbar"]`)).toHaveCount(0);
    const body = page.locator('.ProseMirror').first();
    // A new message focuses the To field just after it opens; wait for
    // that, or it takes the caret away from the text typed below.
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    await body.click();
    await page.keyboard.type('Can we talk at ');
    await expect(body).toHaveText('Can we talk at');
    await page.getByTestId('composer-options-menu').click();
    await page.getByRole('menuitem', { name: 'Insert time in other zones…' }).click();
    const dialog = slotFrame(page, 'plugin-dialog');
    await dialog.getByLabel('Date').fill('2026-10-14');
    await dialog.getByLabel('Time in Berlin').fill('15:00');
    await expect(dialog.getByLabel('Text to paste')).toHaveValue(/^3:00\sPM Berlin \/ 9:00\sAM New York$/);
    // The buttons are in the host's dialog footer, not in the frame.
    const host = page.getByRole('dialog').filter({ hasText: 'Time in several zones' });
    await expect(dialog.getByRole('button', { name: 'Insert' })).toHaveCount(0);
    await expect(host.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await shootThemed(page, 'composer', theme);

    // Insert writes the line where the cursor is in the message.
    await host.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(host).toHaveCount(0);
    await expect(body).toContainText(/Can we talk at 3:00\sPM Berlin \/ 9:00\sAM New York/);
    // Clean up: throw the draft away (best effort, the test already passed).
    try {
      await page.getByRole('button', { name: 'Discard', exact: true }).click({ timeout: 10_000, force: true });
      const confirm = page.getByRole('button', { name: /^(Discard|Delete)$/ }).last();
      if (await confirm.isVisible().catch(() => false)) await confirm.click({ timeout: 10_000 });
    } catch { /* the draft stays in Drafts */ }
  });
}

// ─── World clock ─────────────────────────────────────────────

for (const theme of ['light', 'dark']) {
  test(`world clock in the sidebar, only when turned on (${theme})`, async ({ page }) => {
    await preparePage(page, { theme });
    await signIn(page);
    await waitForPlugin(page, ID);
    await setUserSettings(page, { 'World clock in the sidebar': false, 'Favourite time zones': 'New York, Tokyo', 'Your time zone': 'Europe/Berlin' });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlugin(page, ID);
    await expect.poll(() => readMirror(page), { timeout: 60_000 }).not.toBe('');
    await expect(page.locator(`[data-plugin-sidebar-section="${ID}"]`)).toHaveCount(0);

    try {
      await setUserSettings(page, { 'World clock in the sidebar': true, 'Your time zone': 'Europe/Berlin' });
      await useTheme(page, theme);
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      const clock = slotFrame(page, 'sidebar-section');
      await expect(clock.getByTitle(/^Berlin · UTC\+\d/)).toBeVisible({ timeout: 60_000 });
      await expect(clock.getByTitle(/^New York · /)).toContainText('New York');
      await expect(clock.getByTitle(/^Tokyo · /)).toContainText(/\d{1,2}:\d\d/);
      await shootThemed(page, 'world-clock', theme);
    } finally {
      await setUserSettings(page, { 'World clock in the sidebar': false, 'Your time zone': 'Europe/Berlin' });
    }
  });
}
