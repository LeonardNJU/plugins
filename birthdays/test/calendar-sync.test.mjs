import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import {
  calendarErrorText, keyFromDescription, loadManagedEvents, markerFor, planSync, syncCalendar,
} from '../src/lib/calendar-sync.js';
import { CALENDAR_KEY, LOCK_KEY, createBackground } from '../src/lib/background.js';
import { daysBetween } from '../src/lib/dates.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const i18n = fakeApi({ translations: manifest.locales }).i18n;
const TODAY = '2026-10-14';

const ada = { key: 'ada', name: 'Ada', year: 1990, month: 10, day: 20 };
const ben = { key: 'ben', name: 'Ben', year: null, month: 3, day: 1 };
const title = (b) => `${b.name}’s birthday`;
const desc = (b) => `From your contacts. This event is kept up to date automatically; change the date in the contact.\n\n${markerFor(b.key)}`;
const ev = (id, b, date, extra = {}) => ({ id, key: b.key, date, title: title(b), description: desc(b), ...extra });

/** A calendar in memory, answering the way the host's api.calendar does. */
function fakeCalendar(initial = []) {
  const events = new Map(initial.map((e) => [e.id, { ...e }]));
  let next = 1;
  return {
    events,
    handlers: {
      'calendar.getEvents': async ({ from, to }) => {
        expect(daysBetween(from, to)).toBeLessThanOrEqual(366);
        return [...events.values()]
          .filter((e) => e.start.slice(0, 10) >= from && e.start.slice(0, 10) < to)
          .map((e) => ({ isRecurring: false, ...e }));
      },
      'calendar.createEvent': async (input) => {
        const id = `e${next++}`;
        events.set(id, { id, title: input.title, description: input.description, start: input.start, isAllDay: input.isAllDay });
        return { id };
      },
      'calendar.updateEvent': async (id, patch) => {
        if (!events.has(id)) throw new Error(`calendar.updateEvent: no event with id "${id}"`);
        Object.assign(events.get(id), patch);
      },
      'calendar.deleteEvent': async (id) => { events.delete(id); },
    },
  };
}

describe('markers', () => {
  it('finds the contact again in the description, also for odd ids', () => {
    expect(keyFromDescription(`Text\n\n${markerFor('acc:c 1]')}`)).toBe('acc:c 1]');
    expect(keyFromDescription('A meeting about [birthdays]')).toBeNull();
    expect(keyFromDescription(undefined)).toBeNull();
  });
});

describe('planSync', () => {
  const plan = (events, birthdays = [ada, ben], enabled = true) => planSync({ birthdays, events, today: TODAY, enabled, i18n });

  it('creates one all-day event per contact on the next birthday', () => {
    expect(plan([]).create).toEqual([
      { key: 'ada', event: { title: 'Ada’s birthday', description: desc(ada), start: '2026-10-20', isAllDay: true } },
      { key: 'ben', event: { title: 'Ben’s birthday', description: desc(ben), start: '2027-03-01', isAllDay: true } },
    ]);
  });

  it('changes nothing when the calendar is up to date, and keeps past years', () => {
    const p = plan([ev('1', ada, '2026-10-20'), ev('2', ben, '2027-03-01'), ev('3', ben, '2026-03-01')]);
    expect(p).toEqual({ create: [], update: [], remove: [] });
  });

  it('adds next year once this year’s birthday has passed', () => {
    const p = planSync({ birthdays: [ada], events: [ev('1', ada, '2026-10-20')], today: '2026-10-21', enabled: true, i18n });
    expect(p.create.map((c) => c.event.start)).toEqual(['2027-10-20']);
    expect(p.remove).toEqual([]);
  });

  it('moves the event when the birthday changes, and drops past events on the old date', () => {
    const moved = { ...ada, month: 11, day: 2 };
    const p = plan([ev('1', ada, '2026-10-20'), ev('old', ada, '2025-10-20')], [moved]);
    expect(p.update).toEqual([{ id: '1', key: 'ada', patch: { start: '2026-11-02', isAllDay: true } }]);
    expect(p.remove).toEqual(['old']);
    expect(p.create).toEqual([]);
  });

  it('renames the event when the contact is renamed', () => {
    const p = plan([ev('1', ada, '2026-10-20')], [{ ...ada, name: 'Ada L.' }]);
    expect(p.update).toEqual([{ id: '1', key: 'ada', patch: { title: 'Ada L.’s birthday' } }]);
  });

  it('removes events of deleted contacts and removed birthdays', () => {
    const p = plan([ev('1', ada, '2026-10-20'), ev('2', ben, '2027-03-01'), ev('3', ben, '2026-03-01')], [ada]);
    expect(p.remove.sort()).toEqual(['2', '3']);
  });

  it('removes duplicates, keeping the one on the right day', () => {
    const p = plan([ev('b', ada, '2026-10-21'), ev('a', ada, '2026-10-20'), ev('c', ada, '2026-10-20'), ev('p1', ada, '2025-10-20'), ev('p2', ada, '2025-10-20')], [ada]);
    expect(p.update).toEqual([]);
    expect(p.remove.sort()).toEqual(['b', 'c', 'p2']);
  });

  it('removes everything when turned off', () => {
    const p = plan([ev('1', ada, '2026-10-20'), ev('2', ben, '2026-03-01')], [ada, ben], false);
    expect(p).toEqual({ create: [], update: [], remove: ['1', '2'] });
  });

  it('puts a February 29 birthday on February 28 in other years', () => {
    const leap = { key: 'leap', name: 'Leap', year: 2000, month: 2, day: 29 };
    expect(planSync({ birthdays: [leap], events: [], today: '2027-01-01', enabled: true, i18n }).create[0].event.start).toBe('2027-02-28');
    // Last year's event on the 28th is the right one, not a stale date.
    const p = planSync({ birthdays: [leap], events: [ev('x', leap, '2027-02-28')], today: '2027-06-01', enabled: true, i18n });
    expect(p.remove).toEqual([]);
    expect(p.create[0].event.start).toBe('2028-02-29');
  });
});

describe('loadManagedEvents', () => {
  it('reads a year back and a year ahead in slices the host accepts, only marked events, once each', async () => {
    const cal = fakeCalendar([
      { id: 'm1', title: 'x', description: desc(ada), start: '2026-10-20T00:00:00' },
      { id: 'm2', title: 'x', description: desc(ben), start: '2025-10-15' },
      { id: 'far', title: 'x', description: desc(ben), start: '2028-01-01' },
      { id: 'other', title: 'Dentist', description: 'bring card', start: '2026-10-21T09:00:00' },
    ]);
    // The host's range is inclusive at the end, so an event on a slice
    // boundary comes back twice.
    cal.events.set('edge', { id: 'edge', title: 'x', description: desc(ada), start: '2025-12-14' });
    const api = fakeApi({
      handlers: {
        'calendar.getEvents': async ({ from, to }) => [...cal.events.values()]
          .filter((e) => e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= to)
          .map((e) => ({ isRecurring: false, ...e })),
      },
    });
    const events = await loadManagedEvents(api, TODAY);
    expect(events.map((e) => [e.id, e.key, e.date]).sort())
      .toEqual([['edge', 'ada', '2025-12-14'], ['m1', 'ada', '2026-10-20'], ['m2', 'ben', '2025-10-15']]);
    const ranges = api.calls('calendar.getEvents').map((c) => c.args[0]);
    expect(ranges[1].from).toBe('2025-12-14');
    for (const r of ranges) expect(daysBetween(r.from, r.to)).toBeLessThanOrEqual(366);
    expect(ranges[0].from).toBe('2025-10-14');
    expect(ranges.at(-1).to).toBe('2027-10-15');
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].from).toBe(ranges[i - 1].to);
  });
});

describe('syncCalendar', () => {
  it('applies the plan and is a no-op the second time', async () => {
    const cal = fakeCalendar();
    const api = fakeApi({ translations: manifest.locales, handlers: cal.handlers });
    const first = await syncCalendar(api, { birthdays: [ada, ben], today: TODAY, enabled: true });
    expect(first).toMatchObject({ created: 2, failed: 0 });
    const second = await syncCalendar(api, { birthdays: [ada, ben], today: TODAY, enabled: true });
    expect(second).toMatchObject({ created: 0, updated: 0, removed: 0, failed: 0 });
    expect([...cal.events.values()].map((e) => e.start).sort()).toEqual(['2026-10-20', '2027-03-01']);
  });

  it('calls beat before every change, to renew the lock', async () => {
    const cal = fakeCalendar([{ id: 'stale', title: 'x', description: desc({ key: 'gone' }), start: '2026-11-01' }]);
    const api = fakeApi({ translations: manifest.locales, handlers: cal.handlers });
    let beats = 0;
    await syncCalendar(api, { birthdays: [ada, ben], today: TODAY, enabled: true, beat: async () => { beats += 1; } });
    expect(beats).toBe(3);
  });

  it('keeps going after a failed change and reports it', async () => {
    const cal = fakeCalendar();
    const api = fakeApi({
      translations: manifest.locales,
      handlers: { ...cal.handlers, 'calendar.createEvent': async (input) => (input.title.startsWith('Ada') ? null : cal.handlers['calendar.createEvent'](input)) },
    });
    const result = await syncCalendar(api, { birthdays: [ada, ben], today: TODAY, enabled: true });
    expect(result).toMatchObject({ created: 1, failed: 1 });
    expect(result.error.message).toBe('the calendar refused the change');
  });

  it('explains read-only calendars and full storage in plain words', () => {
    expect(calendarErrorText(new Error('Forbidden: mayWrite is false'), i18n)).toBe('Your default calendar is read-only.');
    expect(calendarErrorText(new Error('overQuota'), i18n)).toBe('Your storage on the server is full.');
    expect(calendarErrorText(new Error('API call calendar.createEvent timed out after 30s'), i18n)).toBe('The server took too long to answer. Try again in a moment.');
  });
});

describe('background calendar sync', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  const card = (id, name, date) => ({ id, name: { full: name }, anniversaries: { a: { kind: 'birth', date } } });

  function setup({ settings = { addToCalendar: true }, calendar = fakeCalendar(), extra = {} } = {}) {
    const state = { contacts: [card('ada', 'Ada', '--10-20'), card('ben', 'Ben', '--03-01')] };
    const api = fakeApi({
      settings: { notify: false, ...settings },
      translations: manifest.locales,
      handlers: { 'contacts.list': async () => state.contacts, ...calendar.handlers, ...extra },
    });
    const clock = { now: new Date(2026, 9, 14, 9) };
    const bg = createBackground(api, { now: () => clock.now });
    return { api, bg, state, cal: calendar, clock };
  }
  // Lets a run started by a listener finish (setImmediate is not faked).
  const flush = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); };
  const starts = (cal) => [...cal.events.values()].map((e) => `${e.title}@${e.start.slice(0, 10)}`).sort();

  it('adds, moves and removes events as contacts change', async () => {
    const { api, bg, state, cal } = setup();
    await bg.run();
    expect(starts(cal)).toEqual(['Ada’s birthday@2026-10-20', 'Ben’s birthday@2027-03-01']);
    expect(api.storageSnapshot()[CALENDAR_KEY]).toBe(true);

    state.contacts = [card('ada', 'Ada', '--10-25'), card('ben', 'Ben', '--03-01')];
    await bg.run();
    expect(starts(cal)).toEqual(['Ada’s birthday@2026-10-25', 'Ben’s birthday@2027-03-01']);

    state.contacts = [card('ada', 'Ada', '--10-25'), { id: 'ben', name: { full: 'Ben' } }];
    await bg.run();
    expect(starts(cal)).toEqual(['Ada’s birthday@2026-10-25']);

    state.contacts = [];
    await bg.run();
    expect(starts(cal)).toEqual([]);
  });

  it('leaves the calendar alone when the setting was never on', async () => {
    const { api, bg } = setup({ settings: { addToCalendar: false } });
    await bg.run();
    expect(api.calls().filter((c) => c.method.startsWith('calendar.'))).toEqual([]);
  });

  it('removes its events when the setting is turned off, then stops looking', async () => {
    const { api, bg, cal } = setup();
    bg.activate();
    await bg.run();
    expect(cal.events.size).toBe(2);
    api.changeSettings({ addToCalendar: false });
    await bg.run();
    expect(cal.events.size).toBe(0);
    expect(api.storageSnapshot()[CALENDAR_KEY]).toBeUndefined();
    const before = api.calls('calendar.getEvents').length;
    await bg.run();
    expect(api.calls('calendar.getEvents').length).toBe(before);
  });

  it('syncs right away when the setting is turned on or off', async () => {
    const { api, bg, cal } = setup({ settings: { addToCalendar: false } });
    bg.activate();
    await bg.run();
    api.changeSettings({ addToCalendar: true });
    await flush();
    expect(cal.events.size).toBe(2);
    api.changeSettings({ notify: true });
    api.changeSettings({ addToCalendar: false });
    await flush();
    expect(cal.events.size).toBe(0);
  });

  it('does not duplicate events with its storage cleared (another browser)', async () => {
    const cal = fakeCalendar();
    await setup({ calendar: cal }).bg.run();
    await setup({ calendar: cal }).bg.run();
    expect(cal.events.size).toBe(2);
  });

  it('waits while another tab holds the lock, then tries again', async () => {
    const { api, bg, cal, clock } = setup();
    await api.storage.set(LOCK_KEY, new Date(2026, 9, 14, 9, 0, 20).getTime());
    await bg.run();
    expect(api.calls('calendar.getEvents')).toEqual([]);
    clock.now = new Date(2026, 9, 14, 9, 0, 21);
    await vi.advanceTimersByTimeAsync(21_000);
    await flush();
    expect(cal.events.size).toBe(2);
  });

  it('tells the user once per session in plain words when the calendar refuses', async () => {
    const { api, bg } = setup({ extra: { 'calendar.createEvent': async () => { throw new Error('Forbidden'); } } });
    await bg.run();
    await bg.run();
    expect(api.calls('toast.error').map((c) => c.args[0]))
      .toEqual(['The birthdays in your calendar could not be updated. Your default calendar is read-only.']);
    expect(api.storageSnapshot()[LOCK_KEY]).toBeUndefined();
  });
});
