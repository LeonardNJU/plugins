// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { setApi } from '../src/host.js';
import { EventZones } from '../src/ui/event-zones.jsx';
import manifest from '../manifest.json' with { type: 'json' };
import { button, click, mount, type } from './dom.mjs';

const view = (participants, extra = {}) => ({
  start: '2026-10-14T15:00:00', duration: 'PT1H', timeZone: 'Europe/Berlin', isAllDay: false,
  participants: participants.map((email) => ({ name: '', email, role: 'attendee', status: 'needs-action' })),
  ...extra,
});

const zoneRow = (ui, city) => ui.$$('[role="listitem"]').find((r) => r.firstChild.textContent.split(' · ')[0] === city);

async function setup({ zones = {}, settings = {} } = {}) {
  const api = fakeApi({ settings: { homeZone: 'Europe/Berlin', ...settings }, translations: manifest.locales, locale: 'en-GB' });
  await api.storage.set('addressZones', zones);
  setApi(api);
  return api;
}

describe('event form section', () => {
  afterEach(() => setApi(null));

  it('shows the time for each participant zone and marks late ones', async () => {
    await setup({ zones: { 'kei@example.jp': 'Asia/Tokyo', 'bob@example.org': 'America/Chicago' } });
    const ui = await mount(EventZones, { event: view(['kei@example.jp', 'bob@example.org']) });
    const rows = ui.$$('[role="listitem"]');
    expect(rows.map((r) => r.firstChild.textContent)).toEqual(['Tokyo · kei@example.jp', 'Chicago · bob@example.org']);
    expect(rows[0].textContent).toContain('22:00–23:00');
    expect(rows[0].textContent).toContain('outside working hours');
    expect(rows[1].textContent).toContain('08:00–09:00');
    expect(rows[1].textContent).not.toContain('outside working hours');
    // One warning for the participants outside working hours.
    expect(ui.$('[role="status"][data-tone="warning"]').textContent).toBe('Outside 08:00–20:00 for kei@example.jp (Tokyo)');
    await ui.unmount();
  });

  it('shows favourites and the next-day hint', async () => {
    await setup({ settings: { favouriteZones: 'Auckland' } });
    const ui = await mount(EventZones, { event: view([]) });
    const row = zoneRow(ui, 'Auckland');
    expect(row.textContent).toContain('02:00–03:00');
    expect(row.textContent).toContain('(next day)');
    expect(row.textContent).toContain('favourite');
    // Favourites are marked, not warned about.
    expect(row.textContent).toContain('outside working hours');
    expect(ui.$('[data-tone="warning"][role="status"]')).toBeNull();
    await ui.unmount();
  });

  it('lets the user set a missing zone, which then shows up', async () => {
    const api = await setup();
    const ui = await mount(EventZones, { event: view(['new@example.com']) });
    expect(ui.text()).toContain('No time zone for new@example.com');
    await click(button(ui.container, 'Time zone for new@example.com'));
    await type(ui.$('input'), 'Chicago');
    await click(button(ui.container, 'Save'));
    expect(api.storageSnapshot().addressZones).toEqual({ 'new@example.com': 'America/Chicago' });
    expect(zoneRow(ui, 'Chicago').textContent).toContain('new@example.com');
    expect(ui.text()).not.toContain('No time zone for');
    await ui.unmount();
  });

  it('says so when the zone is unknown and stores nothing', async () => {
    const api = await setup();
    const ui = await mount(EventZones, { event: view(['new@example.com']) });
    await click(button(ui.container, 'Time zone for new@example.com'));
    await type(ui.$('input'), 'Atlantis');
    await click(button(ui.container, 'Save'));
    expect(ui.$('[role="alert"]').textContent).toContain('Unknown time zone');
    expect(api.storageSnapshot().addressZones).toEqual({});
    await ui.unmount();
  });

  it('shows nothing for all-day events or without zones', async () => {
    await setup({ zones: { 'kei@example.jp': 'Asia/Tokyo' } });
    const a = await mount(EventZones, { event: view(['kei@example.jp'], { isAllDay: true }) });
    expect(a.container.innerHTML).toBe('');
    await a.unmount();
    const b = await mount(EventZones, { event: view([]) });
    expect(b.container.innerHTML).toBe('');
    await b.unmount();
  });
});
