// End to end: the plugin installed by the admin, 17TRACK set up against the
// test mock (http://localhost:18099), mail in alice's Stalwart mailbox.
import { test, expect } from '@playwright/test';
import { BASE, adminApi, installPlugin, preparePage, setPluginConfig, shoot, signIn, uninstallPlugin, waitForPlugin } from '../../e2e/helpers.mjs';
import { destroyMail, findBySubject, sendMail } from './jmap.mjs';

const ID = 'parcels';
const MOCK = process.env.MOCK_URL || 'http://localhost:18099';
const CHANGING = 'JJD000390007878901234';
// What the card shows after the mock's 1st, 2nd, 3rd and 4th answer for the changing number.
const STEPS = ['Label created', 'In transit', 'Out for delivery', 'Delivered'];

const banner = (page) => page.frameLocator(`[data-plugin-iframe-slot="${ID}:email-banner"] iframe`);
// The deliveries section in the mail sidebar; the host draws its header.
const widget = (page) => page.frameLocator(`[data-plugin-iframe-slot="${ID}:sidebar-section"] iframe`);
const sectionHeader = (page) => page.locator(`[data-plugin-sidebar-section="${ID}"] > button`);
// The plugin-dialog slot inside the host's dialog, and the buttons the host draws in its footer.
const dialogFrame = (page) => page.frameLocator('div[role="dialog"] iframe').first();
const footerButton = (page, name) => page.locator('[data-plugin-dialog-buttons]').getByRole('button', { name, exact: true });

async function setUp({ token = 'test-17track-token', dhlKey = 'test-dhl-key' } = {}) {
  const api = await adminApi();
  // Other suites change the plugin registry at the same time; a write that
  // collides with theirs fails with 500, so try again.
  for (let attempt = 1; ; attempt++) {
    try {
      await installPlugin(api, ID);
      break;
    } catch (err) {
      if (attempt >= 4 || !/HTTP 5\d\d/.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  await setPluginConfig(api, ID, 'track17Url', `${MOCK}/17track/track/v2.2`);
  await setPluginConfig(api, ID, 'track17Token', token);
  if (dhlKey) {
    await setPluginConfig(api, ID, 'dhlUrl', `${MOCK}/dhl/track/shipments`);
    await setPluginConfig(api, ID, 'dhlKey', dhlKey);
  }
  return api;
}

/**
 * Show the page in this theme. alice's settings sync from the server, and
 * other suites change her theme there; rewrite it in what the page reads
 * instead of changing her settings.
 */
async function pinTheme(page, theme) {
  await page.route('**/api/settings*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    let body = await res.text();
    try {
      const fix = (o) => {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
          if (k === 'theme' && typeof v === 'string') o[k] = theme;
          else fix(v);
        }
      };
      const json = JSON.parse(body);
      fix(json);
      body = JSON.stringify(json);
    } catch { /* not JSON: leave it */ }
    await route.fulfill({ response: res, body });
  });
}

/** Open a message by its permalink (/mail/message/<id>), on any screen size. */
async function openMessage(page, subject) {
  let ids = [];
  for (let i = 0; i < 20 && !ids.length; i++) {
    ids = await findBySubject(subject);
    if (!ids.length) await page.waitForTimeout(3000);
  }
  expect(ids, `message "${subject}"`).not.toHaveLength(0);
  await page.goto(`${BASE}/mail/message/${ids[0]}`);
  await waitForPlugin(page, ID);
}

/** How often the mock has answered for the changing number (it moves on with every read). */
async function polls(service, number) {
  const state = await (await fetch(`${MOCK}/__state`)).json();
  return Number(state.polls?.[`${service}:${number}`] ?? 0);
}

test.describe.configure({ mode: 'serial', timeout: 600_000 });


test('reader card shows carrier, number and live status of the seeded shipping mail', async ({ browser }) => {
  const api = await setUp();
  try {
    expect(await findBySubject('Your order has shipped')).not.toHaveLength(0);
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
      const page = await context.newPage();
      await preparePage(page, { theme });
      await pinTheme(page, theme);
      await signIn(page);
      await waitForPlugin(page, ID);
      await openMessage(page, 'Your order has shipped');

      const card = banner(page);
      // The DHL number goes to the DHL API, the UPS number to 17TRACK.
      const dhl = card.locator('[data-parcel="00340434161094042557"]');
      await expect(dhl.getByText('DHL', { exact: true })).toBeVisible();
      await expect(dhl.locator('[data-status="in_transit"]')).toHaveText('In transit');
      await expect(dhl.getByText(/parcel center · Hannover, DE/)).toBeVisible();
      const ups = card.locator('[data-parcel="1Z999AA10123456784"]');
      await expect(ups.getByRole('button', { name: 'Track at UPS' })).toBeVisible();
      await expect(ups.locator('[data-status="delivered"]')).toHaveText('Delivered');

      // Opening the message put both parcels in the deliveries widget.
      await expect(widget(page).locator('[data-parcel="00340434161094042557"]')).toBeVisible({ timeout: 30_000 });
      await shoot(page, ID, 'reader-card', theme);

      // The section header is the host's, with the plugin's translated title.
      await expect(sectionHeader(page)).toHaveText('Deliveries');

      // Mark received: gone from the section, the card's button stays pressed.
      if (theme === 'light') {
        await ups.getByRole('button', { name: 'Mark received' }).click();
        await expect(ups.getByRole('button', { name: 'Received', pressed: true })).toBeVisible();
        await expect(widget(page).locator('[data-parcel="1Z999AA10123456784"]')).toHaveCount(0, { timeout: 30_000 });
      }
      await context.close();
    }
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('a new shipping mail is followed and its status change notifies', async ({ page }) => {
  // The changing mock number through 17TRACK: no DHL key is set up, so the
  // DHL number falls back to it.
  const service = '17track';
  const api = await setUp({ dhlKey: null });
  const subject = `Ihre DHL Sendung ist unterwegs ${Date.now().toString(36)}`;
  let sent = false;
  try {
    await preparePage(page);
    await pinTheme(page, 'light');
    await signIn(page);
    await waitForPlugin(page, ID);

    // Let the first mail sync finish: the webmail reports as new only what
    // arrives after it.
    await expect(page.getByText('Your order has shipped').first()).toBeAttached({ timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(10_000);

    // The mock number stops at Delivered after three answers. Only then
    // reset the mock (this also restores its Todoist tasks, see
    // test-env/mocks/README.md).
    if (await polls(service, CHANGING) >= 3) {
      await fetch(`${MOCK}/__reset`, { method: 'POST' });
      test.info().annotations.push({ type: 'note', description: 'reset the mock counters' });
    }
    const before = await polls(service, CHANGING);
    // The number is only in the schema.org markup, not in the text.
    sent = !!sendMail({
      from: 'DHL Paket <noreply@dhl.example>',
      subject,
      text: 'Ihre Sendung ist unterwegs. Den aktuellen Status finden Sie in der Sendungsverfolgung.',
      html: `<html><head><script type="application/ld+json">${JSON.stringify({
        '@context': 'http://schema.org', '@type': 'ParcelDelivery',
        trackingNumber: CHANGING, carrier: { '@type': 'Organization', name: 'DHL' },
      })}</script></head><body><p>Ihre Sendung ist unterwegs.</p></body></html>`,
    });

    // Picked up from the new mail without opening it, then polled once.
    // Push from Stalwart brings the mail in and the webmail hands it to the
    // plugin as new mail.
    const item = widget(page).locator(`[data-parcel="${CHANGING}"]`);
    await expect(item).toBeVisible({ timeout: 120_000 });
    await expect(item).toContainText(subject);
    // Exactly one answer from the mock for this number, shown in the widget.
    await expect(item).not.toHaveAttribute('data-status', '', { timeout: 90_000 });
    expect(await polls(service, CHANGING)).toBe(before + 1);
    const firstPoll = Math.min(before + 1, 4);
    await expect(item).toContainText(STEPS[firstPoll - 1]);

    // Pretend the last poll was half an hour ago; the next once-a-minute
    // round asks again, sees the next status and notifies.
    await page.evaluate((number) => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('plugin:parcels:') && key.endsWith(`parcel:${number}`)) {
          const p = JSON.parse(localStorage.getItem(key));
          p.lastPolledAt -= 31 * 60_000;
          localStorage.setItem(key, JSON.stringify(p));
        }
      }
    }, CHANGING);
    const next = STEPS[firstPoll];
    await expect(page.getByText(`Parcel update: ${next}`)).toBeVisible({ timeout: 90_000 });
    await shoot(page, ID, 'status-notification', 'light');
    await expect(item).toContainText(next, { timeout: 30_000 });
    expect(await polls(service, CHANGING)).toBe(before + 2);

    // The reader card shows the same parcel, from the JSON-LD.
    await openMessage(page, subject);
    const row = banner(page).locator(`[data-parcel="${CHANGING}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByText('DHL', { exact: true })).toBeVisible();
  } finally {
    if (sent) await findBySubject(subject).then((ids) => ids.length && destroyMail(ids)).catch(() => {});
    await uninstallPlugin(api, ID);
  }
});

test('a number added by hand is followed, and a parcel opens in a dialog', async ({ browser }) => {
  const api = await setUp();
  const NUMBER = '00340434161094042557';
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
      const page = await context.newPage();
      await preparePage(page, { theme });
      await pinTheme(page, theme);
      await signIn(page);
      await waitForPlugin(page, ID);

      // Nothing followed yet in this browser.
      const section = widget(page);
      await expect(section.getByText('No parcels on the way.')).toBeVisible({ timeout: 30_000 });
      await section.getByRole('button', { name: 'Add tracking number' }).click();

      // The add dialog: the field in the frame, Cancel and Add in the host's footer.
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Add tracking number');
      const field = dialogFrame(page).getByLabel('Tracking number');
      await expect(field).toBeVisible();
      await expect(footerButton(page, 'Add')).toBeDisabled();
      await field.fill('12345');
      await footerButton(page, 'Add').click();
      await expect(dialogFrame(page).getByText("That doesn't look like a tracking number.")).toBeVisible();
      await field.fill(NUMBER);
      await shoot(page, ID, 'add-dialog', theme);
      await footerButton(page, 'Add').click();
      await expect(dialog).toBeHidden();

      // Looked up right away: the DHL mock says in transit.
      const item = section.locator(`[data-parcel="${NUMBER}"]`);
      await expect(item).toHaveAttribute('data-status', 'in_transit', { timeout: 30_000 });
      await expect(item).toContainText('In transit');
      await shoot(page, ID, 'deliveries', theme);

      // The row opens the parcel; Mark received in the footer takes it off the list.
      await item.getByRole('button').click();
      await expect(dialogFrame(page).locator('[data-status="in_transit"]')).toHaveText('In transit');
      await expect(footerButton(page, 'Track at DHL')).toBeVisible();
      await shoot(page, ID, 'parcel-dialog', theme);
      if (theme === 'light') {
        await footerButton(page, 'Mark received').click();
        await expect(dialog).toBeHidden();
        await expect(item).toHaveCount(0, { timeout: 30_000 });
        await expect(section.getByText('No parcels on the way.')).toBeVisible();
      }
      await context.close();
    }
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('a rejected API key is explained in plain words', async ({ page }) => {
  const api = await setUp({ token: 'wrong-token', dhlKey: 'wrong-key' });
  try {
    await preparePage(page);
    await signIn(page);
    await waitForPlugin(page, ID);
    await openMessage(page, 'Your order has shipped');
    const dhl = banner(page).locator('[data-parcel="00340434161094042557"]');
    await expect(dhl.getByRole('status')).toHaveText("The tracking service didn't accept the API key. Ask your administrator to check it.");
  } finally {
    await uninstallPlugin(api, ID);
  }
});

test('the reader card fits a phone screen', async ({ browser }) => {
  const api = await setUp();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await preparePage(page);
    await pinTheme(page, 'light');
    await signIn(page);
    await waitForPlugin(page, ID);
    await openMessage(page, 'Your order has shipped');
    const card = banner(page);
    await expect(card.locator('[data-parcel="00340434161094042557"] [data-status]')).toBeVisible();
    const overflow = await card.locator('body').evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shoot(page, ID, 'reader-card-phone', 'light');
    await context.close();
  } finally {
    await uninstallPlugin(api, ID);
  }
});
