// End to end against the webmail and the Stalwart test server: contacts are
// seeded over JMAP, the plugin is installed by the admin, and the results
// (widget, reminder, composer, calendar events) are checked in the page and
// on the server.
import { test, expect } from '@playwright/test';
import { BASE, installPlugin, uninstallPlugin, preparePage, signIn, waitForPlugin, shoot } from '../../e2e/helpers.mjs';
import {
  birthdayEvents, createContacts, deleteContacts, deleteEvents, deleteMailWithSubject, eventKey, updateContact,
} from './stalwart.mjs';
import { cachedAdminApi } from './admin-session.mjs';

const ID = 'birthdays';
// Unique per run, so other tests' contacts and leftovers don't interfere.
const RUN = Date.now().toString(36).slice(-5);

function dayFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return { month: d.getMonth() + 1, day: d.getDate(), iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
}
const partial = ({ month, day }, year) => (year ? { year, month, day } : { month, day });

const widget = (page) => page.frameLocator('iframe[title="plugin-birthdays-slot"]');

/**
 * The account's synced settings would switch the theme after sign-in; pin
 * the one the test wants, and keep the test from writing settings back to
 * the shared test account.
 */
async function pinTheme(page, theme) {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, json: { ok: true } });
    const res = await route.fetch();
    const body = await res.json().catch(() => null);
    if (body?.settings) body.settings.theme = theme;
    return route.fulfill({ response: res, json: body ?? {} });
  });
}

async function open(page, theme = 'light') {
  await pinTheme(page, theme);
  await preparePage(page, { theme });
  await signIn(page);
  await waitForPlugin(page, ID);
}

/** Open the notification panel; resolves to its birthday entries. */
async function openPanel(page) {
  await page.locator('[data-notification-bell]').first().click();
  return page.locator('[data-notification-panel] li[data-entry-source="birthdays"]');
}

async function setCalendarOption(page, on) {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Plugins', exact: true }).first().click();
  const card = page.getByRole('button', { name: /Birthday reminders/ }).first();
  if ((await card.getAttribute('aria-expanded')) !== 'true') await card.click();
  const toggle = page.getByRole('switch', { name: 'Add birthdays to my calendar' });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
  // Plugins run on the app pages, not in Settings: back to the mail.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await waitForPlugin(page, ID);
}

/** Events of this run's contacts, by contact id. */
async function ourEvents(contactIds) {
  return (await birthdayEvents()).filter((e) => contactIds.includes(eventKey(e)));
}

test.describe('birthday reminders', () => {
  let admin;
  let contactIds = [];

  test.beforeAll(async () => {
    test.setTimeout(20 * 60 * 1000);
    admin = await cachedAdminApi();
    await installPlugin(admin, ID);
  });

  test.afterAll(async () => {
    if (admin) await uninstallPlugin(admin, ID);
  });

  test.afterEach(async () => {
    const leftovers = await ourEvents(contactIds);
    await deleteEvents(leftovers.map((e) => e.id));
    await deleteContacts(contactIds);
    await deleteMailWithSubject(RUN);
    contactIds = [];
  });

  for (const theme of ['light', 'dark']) {
    test(`the sidebar lists upcoming birthdays and reminds of today's (${theme})`, async ({ page }) => {
      contactIds = await createContacts([
        { name: `Ada Today ${RUN}`, email: `ada-${RUN}@example.org`, date: partial(dayFromToday(0), new Date().getFullYear() - 36) },
        { name: `Ben Soon ${RUN}`, email: `ben-${RUN}@example.org`, date: partial(dayFromToday(2)) },
        { name: `Cy Later ${RUN}`, date: partial(dayFromToday(60)) },
      ]);
      await open(page, theme);

      const w = widget(page);
      await expect(w.getByRole('heading', { name: 'Upcoming birthdays' })).toBeVisible({ timeout: 30_000 });
      const ada = w.locator('li', { hasText: `Ada Today ${RUN}` });
      await expect(ada).toContainText('Today');
      await expect(ada).toContainText('turns 36');
      await expect(w.locator('li', { hasText: `Ben Soon ${RUN}` })).toContainText('In 2 days');
      // 60 days ahead is outside the default 30-day window.
      await expect(w.locator('li', { hasText: `Cy Later ${RUN}` })).toHaveCount(0);

      // The reminders land in the notification panel (and as a toast, or a
      // system notification when the browser allows them).
      const panel = await openPanel(page);
      await expect(panel.filter({ hasText: `It’s Ada Today ${RUN}’s birthday today` })).toHaveCount(1, { timeout: 30_000 });
      await expect(panel.filter({ hasText: `Ben Soon ${RUN}’s birthday is in 2 days` })).toHaveCount(1);
      await shoot(page, ID, 'reminders', theme);
      await page.keyboard.press('Escape');
      await shoot(page, ID, 'sidebar', theme);

      // Reloading the app does not repeat today's reminders.
      await page.reload();
      await waitForPlugin(page, ID);
      await expect(widget(page).locator('li', { hasText: `Ada Today ${RUN}` })).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(5000);
      const again = await openPanel(page);
      await expect(again.filter({ hasText: `It’s Ada Today ${RUN}’s birthday today` })).toHaveCount(1);

      // Clicking the reminder opens a greeting to Ada.
      await again.filter({ hasText: `It’s Ada Today ${RUN}’s birthday today` }).getByRole('button').click();
      await expect(page.locator('input[placeholder="Subject"]')).toHaveValue('Happy birthday, Ada!', { timeout: 20_000 });
      await page.locator('input[placeholder="Subject"]').fill(`Happy birthday, Ada! ${RUN}`);
    });
  }

  for (const theme of ['light', 'dark']) {
    test(`send greeting opens the composer for the contact (${theme})`, async ({ page }) => {
      contactIds = await createContacts([
        { name: `Dora Greet ${RUN}`, email: `dora-${RUN}@example.org`, date: partial(dayFromToday(1)) },
      ]);
      await open(page, theme);
      const row = widget(page).locator('li', { hasText: `Dora Greet ${RUN}` });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.getByRole('button', { name: `Send Dora Greet ${RUN} a birthday greeting` }).click();

      const subject = page.locator('input[placeholder="Subject"]');
      await expect(subject).toHaveValue('Happy birthday, Dora!', { timeout: 20_000 });
      await expect(page.getByText(`dora-${RUN}@example.org`).first()).toBeVisible();
      await subject.fill(`Happy birthday, Dora! ${RUN}`);
      await shoot(page, ID, 'greeting', theme);
    });
  }

  test('the widget fits a phone screen, in the menu', async ({ page }) => {
    contactIds = await createContacts([
      { name: `Gus Phone ${RUN}`, email: `gus-${RUN}@example.org`, date: partial(dayFromToday(3), 1980) },
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByRole('button', { name: 'Toggle menu' }).first().click();
    const row = widget(page).locator('li', { hasText: `Gus Phone ${RUN}` });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('turns');
    const greet = row.getByRole('button', { name: `Send Gus Phone ${RUN} a birthday greeting` });
    await expect(greet).toBeVisible();
    const box = await page.locator('iframe[title="plugin-birthdays-slot"]').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.locator('iframe[title="plugin-birthdays-slot"]').scrollIntoViewIfNeeded();
    // Let the reminder toast go, it covers the bottom of the menu.
    await page.waitForTimeout(7000);
    await shoot(page, ID, 'phone', 'light');
  });

  test('keeps birthday events in the calendar in step with the contacts', async ({ page }) => {
    const ada = dayFromToday(5);
    const ben = dayFromToday(40);
    contactIds = await createContacts([
      { name: `Eve Calendar ${RUN}`, email: `eve-${RUN}@example.org`, date: partial(ada, 1990) },
      { name: `Finn Calendar ${RUN}`, date: partial(ben) },
    ]);
    const [eve, finn] = contactIds;
    await open(page);
    await setCalendarOption(page, true);
    await expect.poll(async () => (await ourEvents(contactIds)).map((e) => `${e.title}@${e.start.slice(0, 10)}`).sort(), { timeout: 90_000 })
      .toEqual([`Eve Calendar ${RUN}’s birthday@${ada.iso}`, `Finn Calendar ${RUN}’s birthday@${ben.iso}`]);
    for (const e of await ourEvents(contactIds)) {
      expect(e.showWithoutTime).toBe(true);
    }

    // Another sync (a reload) adds nothing.
    await page.goto(`${BASE}/`);
    await waitForPlugin(page, ID);
    await page.waitForTimeout(8000);
    expect(await ourEvents(contactIds)).toHaveLength(2);

    // The calendar shows the event.
    await page.goto(`${BASE}/calendar`);
    await expect(page.getByText(`Eve Calendar ${RUN}’s birthday`).first()).toBeVisible({ timeout: 30_000 });
    await shoot(page, ID, 'calendar', 'light');

    // Eve's birthday moves, Finn is deleted: after the next check the
    // event moves and Finn's goes.
    const moved = dayFromToday(7);
    await updateContact(eve, { 'anniversaries/a1/date': { '@type': 'PartialDate', year: 1990, month: moved.month, day: moved.day } });
    await deleteContacts([finn]);
    await page.goto(`${BASE}/`);
    await waitForPlugin(page, ID);
    await expect.poll(async () => (await ourEvents(contactIds)).map((e) => `${eventKey(e)}@${e.start.slice(0, 10)}`), { timeout: 90_000 })
      .toEqual([`${eve}@${moved.iso}`]);

    // Turning the option off removes the events.
    await setCalendarOption(page, false);
    await expect.poll(async () => (await ourEvents(contactIds)).length, { timeout: 90_000 }).toBe(0);
  });
});
