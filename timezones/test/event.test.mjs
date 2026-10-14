import { afterEach, describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { eventZones, hourLabel, normaliseEvent, outsideHoursWarning, parseDuration } from '../src/lib/event.js';
import { readSettings } from '../src/lib/settings.js';
import { setApi } from '../src/host.js';
import { EventZones } from '../src/ui/event-zones.jsx';
import plugin from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };

const settings = (extra = {}) => readSettings({ homeZone: 'Europe/Berlin', ...extra });
const ev = (start, end, attendees = [], isAllDay = false) => ({ title: 'Call', start, end, isAllDay, attendees });

describe('eventZones', () => {
  const people = { 'bob@example.org': 'America/Chicago', 'kei@example.jp': 'Asia/Tokyo', 'anna@example.de': 'Europe/Berlin' };

  it('lists each participant zone once with the event time there', () => {
    const info = eventZones(ev('2026-10-14T15:00', '2026-10-14T16:00', ['bob@example.org', 'Kei@example.jp']), settings(), people);
    expect(info.rows.map((r) => r.zone)).toEqual(['America/Chicago', 'Asia/Tokyo']);
    expect(info.rows[0].emails).toEqual(['bob@example.org']);
    expect(info.rows[0].start).toBe(Date.parse('2026-10-14T13:00:00Z'));
    expect(info.rows[1].dayShift).toBe(0);
  });

  it('leaves out participants in your own zone and lists those without one', () => {
    const info = eventZones(ev('2026-10-14T10:00', '2026-10-14T11:00', ['anna@example.de', 'new@example.com']), settings(), people);
    expect(info.rows).toEqual([]);
    expect(info.missing).toEqual(['new@example.com']);
  });

  it('warns for participants outside working hours, not for favourites', () => {
    // 15:00 Berlin = 08:00 Chicago (fine), 22:00 Tokyo (outside).
    const info = eventZones(ev('2026-10-14T15:00', '2026-10-14T16:00', ['bob@example.org', 'kei@example.jp']),
      settings({ favouriteZones: 'Los Angeles' }), people);
    expect(info.warnings.map((r) => r.zone)).toEqual(['Asia/Tokyo']);
    const la = info.rows.find((r) => r.zone === 'America/Los_Angeles');
    expect(la.favourite).toBe(true);
    expect(la.outside).toBe(true); // 06:00 there: marked, but no warning
  });

  it('puts participants before favourites and merges a favourite that is also a participant zone', () => {
    const info = eventZones(ev('2026-10-14T15:00', '2026-10-14T16:00', ['kei@example.jp']), settings({ favouriteZones: 'New York, Tokyo' }), people);
    expect(info.rows.map((r) => [r.zone, r.favourite, r.emails.length])).toEqual([
      ['Asia/Tokyo', true, 1],
      ['America/New_York', true, 0],
    ]);
  });

  it('marks the next day', () => {
    const info = eventZones(ev('2026-10-14T19:00', '2026-10-14T20:00', ['kei@example.jp']), settings(), people);
    expect(info.rows[0].dayShift).toBe(1);
  });

  it('uses the working hours from the settings', () => {
    const info = eventZones(ev('2026-10-14T15:00', '2026-10-14T16:00', ['bob@example.org']), settings({ workStart: 9 }), people);
    expect(info.warnings).toHaveLength(1);
  });

  it('does not warn for all-day events and refuses a form without a start', () => {
    expect(eventZones(ev('2026-10-14T00:00:00', '2026-10-14T23:59:59', ['kei@example.jp'], true), settings(), people).warnings).toEqual([]);
    expect(eventZones(ev('', ''), settings(), people)).toBeNull();
    expect(eventZones(null, settings(), people)).toBeNull();
  });
});

describe('the event form section shape', () => {
  const view = {
    id: '', uid: '', calendarId: 'c', title: 'Call', start: '2026-10-14T15:00:00', duration: 'PT1H30M',
    timeZone: 'Europe/Berlin', isAllDay: false,
    participants: [{ name: 'Kei', email: 'kei@example.jp', role: 'attendee', status: 'needs-action' }],
  };

  it('reads participants, duration and the event time zone', () => {
    expect(normaliseEvent(view)).toEqual({
      start: '2026-10-14T15:00:00', end: null, duration: 'PT1H30M', zone: 'Europe/Berlin', isAllDay: false, attendees: ['kei@example.jp'],
    });
    const info = eventZones(view, readSettings({ homeZone: 'America/New_York' }), { 'kei@example.jp': 'Asia/Tokyo' });
    expect(info.start).toBe(Date.parse('2026-10-14T13:00:00Z'));
    expect(info.end - info.start).toBe(90 * 60_000);
  });

  it('uses the user zone when the event names none', () => {
    const info = eventZones({ ...view, timeZone: null }, readSettings({ homeZone: 'America/New_York' }), {});
    expect(info.start).toBe(Date.parse('2026-10-14T19:00:00Z'));
  });

  it('parses durations', () => {
    expect(parseDuration('PT1H')).toBe(3_600_000);
    expect(parseDuration('P1DT2H')).toBe(26 * 3_600_000);
    expect(parseDuration('P1W')).toBe(7 * 86_400_000);
    expect(parseDuration('PT45M')).toBe(45 * 60_000);
    expect(parseDuration('soon')).toBeNaN();
    expect(parseDuration('P')).toBeNaN();
  });
});

describe('the warning', () => {
  const t = (k, v) => `${k}:${JSON.stringify(v)}`;
  it('names the people and the hours', () => {
    const info = eventZones(ev('2026-10-14T15:00:00', '2026-10-14T16:00:00', ['kei@example.jp']), settings(), { 'kei@example.jp': 'Asia/Tokyo' });
    const w = outsideHoursWarning(info, settings(), t, 'de');
    expect(w).toEqual({
      key: 'timezones-outside-hours',
      severity: 'warning',
      message: 'event.warning:{"from":"08:00","to":"20:00","names":"kei@example.jp (Tokyo)"}',
    });
  });
  it('is null when nobody is outside', () => {
    const info = eventZones(ev('2026-10-14T10:00', '2026-10-14T11:00', ['kei@example.jp']), settings(), {});
    expect(outsideHoursWarning(info, settings(), t, 'de')).toBeNull();
  });
  it('writes hours the way the locale does', () => {
    expect(hourLabel(8, 'de')).toBe('08:00');
    expect(hourLabel(20, 'en-US')).toMatch(/^8:00\sPM$/);
  });
});

describe('onCheckEventConflicts', () => {
  afterEach(() => setApi(null));

  it('adds the warning to the ones other plugins returned', async () => {
    const api = fakeApi({ settings: { homeZone: 'Europe/Berlin' }, translations: manifest.locales });
    await api.storage.set('addressZones', { 'kei@example.jp': 'Asia/Tokyo' });
    setApi(api);
    const other = { key: 'x', message: 'Conflicts with: Standup' };
    const out = await plugin.hooks.onCheckEventConflicts([other], { event: ev('2026-10-14T15:00:00', '2026-10-14T16:00:00', ['kei@example.jp']) });
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(other);
    expect(out[1].message).toMatch(/^Outside 8:00\sAM–8:00\sPM for kei@example\.jp \(Tokyo\)$/);
  });

  it('leaves the list alone when everyone is inside working hours', async () => {
    const api = fakeApi({ settings: { homeZone: 'Europe/Berlin' } });
    await api.storage.set('addressZones', { 'kei@example.jp': 'Asia/Tokyo' });
    setApi(api);
    expect(await plugin.hooks.onCheckEventConflicts([], { event: ev('2026-10-14T09:00:00', '2026-10-14T10:00:00', ['kei@example.jp']) })).toEqual([]);
  });

  it('speaks German', async () => {
    const api = fakeApi({ locale: 'de', settings: { homeZone: 'Europe/Berlin' }, translations: manifest.locales });
    await api.storage.set('addressZones', { 'kei@example.jp': 'Asia/Tokyo' });
    setApi(api);
    const out = await plugin.hooks.onCheckEventConflicts([], { event: ev('2026-10-14T15:00:00', '2026-10-14T16:00:00', ['kei@example.jp']) });
    expect(out[0].message).toBe('Außerhalb von 08:00–20:00 für kei@example.jp (Tokyo)');
  });
});

describe('event form slot', () => {
  afterEach(() => setApi(null));

  it('is offered in the event form', () => {
    expect(plugin.slots['calendar-event-form'].component).toBe(EventZones);
  });

  it('renders nothing before the stored zones are read', () => {
    setApi(fakeApi({ settings: { homeZone: 'Europe/Berlin', favouriteZones: 'Tokyo' }, translations: manifest.locales }));
    // Server rendering runs no effects, so the zones never "load" here.
    expect(renderToStaticMarkup(h(EventZones, { eventData: ev('2026-10-14T15:00', '2026-10-14T16:00') }))).toBe('');
  });
});
