// Birthdays as all-day events in the user's default calendar.
//
// The plugin api can't create recurring events or choose an event's uid
// (CalendarEventInput has neither), so a birthday is kept as one event for
// its next date: after the day has passed, the next sync adds the following
// year's. Each event carries a marker with the contact id in its
// description; that marker, not anything stored in the browser, is how the
// plugin finds its events again, so a second browser or a cleared storage
// doesn't create duplicates, and duplicates two browsers made at the same
// moment are removed on the next sync.

import { addDays, nextOccurrence, occurrenceIn } from './dates.js';
import { errorText } from './format.js';

/** Events are looked for from a year back to a year ahead. */
export const LOOK_BACK_DAYS = 365;
export const LOOK_AHEAD_DAYS = 366;
/** calendar.getEvents returns at most 1000 events, so the range is read in slices. */
export const SLICE_DAYS = 61;

const MARKER_RE = /\[birthdays:([^\]\s]+)\]/;

export function markerFor(key) {
  return `[birthdays:${encodeURIComponent(key)}]`;
}

/** The contact key of a plugin-made event, or null for any other event. */
export function keyFromDescription(description) {
  const m = MARKER_RE.exec(String(description ?? ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

export function eventTitle(birthday, i18n) {
  return i18n.t('event.title', { name: birthday.name }).slice(0, 500);
}

export function eventDescription(birthday, i18n) {
  return `${i18n.t('event.description')}\n\n${markerFor(birthday.key)}`;
}

/**
 * What to change so the calendar matches the birthdays. `events` are the
 * plugin's events found in the calendar: `{ id, key, date, title,
 * description }`. With `enabled` false every one of them goes.
 *
 * Per contact: exactly one event on the next birthday (created, or an
 * existing one moved there when the date changed); past events stay as
 * history unless they are on a date that is no longer the birthday, or are
 * duplicates. Events of contacts that are gone or have no birthday any
 * more are removed.
 */
export function planSync({ birthdays, events, today, enabled, i18n }) {
  const plan = { create: [], update: [], remove: [] };
  const wanted = new Map(enabled ? birthdays.map((b) => [b.key, b]) : []);
  const byKey = new Map();
  for (const e of events) {
    if (!byKey.has(e.key)) byKey.set(e.key, []);
    byKey.get(e.key).push(e);
  }

  for (const [key, list] of byKey) {
    const b = wanted.get(key);
    if (!b) {
      plan.remove.push(...list.map((e) => e.id));
      continue;
    }
    const sorted = [...list].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1));
    const seenPast = new Set();
    for (const e of sorted.filter((x) => x.date < today)) {
      const right = e.date === occurrenceIn(b, Number(e.date.slice(0, 4)));
      if (!right || seenPast.has(e.date)) plan.remove.push(e.id);
      else seenPast.add(e.date);
    }
    const next = nextOccurrence(b, today).date;
    const upcoming = sorted.filter((x) => x.date >= today);
    const keep = upcoming.find((x) => x.date === next) ?? upcoming[0];
    if (keep) {
      const title = eventTitle(b, i18n);
      const description = eventDescription(b, i18n);
      const patch = {};
      if (keep.date !== next) Object.assign(patch, { start: next, isAllDay: true });
      if (keep.title !== title) patch.title = title;
      if (keep.description !== description) patch.description = description;
      if (Object.keys(patch).length) plan.update.push({ id: keep.id, key, patch });
      plan.remove.push(...upcoming.filter((x) => x !== keep).map((x) => x.id));
    } else {
      plan.create.push(newEvent(b, next, i18n));
    }
    wanted.delete(key);
  }

  for (const b of wanted.values()) plan.create.push(newEvent(b, nextOccurrence(b, today).date, i18n));
  return plan;
}

function newEvent(b, date, i18n) {
  return {
    key: b.key,
    event: { title: eventTitle(b, i18n), description: eventDescription(b, i18n), start: date, isAllDay: true },
  };
}

/** The plugin's events from a year back to a year ahead. */
export async function loadManagedEvents(api, today) {
  const found = new Map();
  for (let from = -LOOK_BACK_DAYS; from < LOOK_AHEAD_DAYS; from += SLICE_DAYS) {
    const to = Math.min(from + SLICE_DAYS, LOOK_AHEAD_DAYS);
    const events = await api.calendar.getEvents({ from: addDays(today, from), to: addDays(today, to) });
    if (events.length >= 1000) api.log.warn('more than 1000 events in a slice; some birthdays may be missed');
    for (const e of events) {
      const key = keyFromDescription(e.description);
      if (key === null || e.isRecurring) continue;
      // Keyed by id: an event on a slice boundary comes back twice.
      found.set(e.id, { id: e.id, key, date: String(e.start).slice(0, 10), title: e.title, description: e.description });
    }
  }
  return [...found.values()];
}

/** A plain-words reason for a failed calendar change. */
export function calendarErrorText(err, i18n) {
  const message = String(err?.message ?? err ?? '').toLowerCase();
  if (/forbidden|read-?only|maywrite|not allowed/.test(message)) return i18n.t('error.readOnly');
  if (/quota|507|storage is full/.test(message)) return i18n.t('error.quota');
  return errorText(err, i18n);
}

/**
 * Bring the calendar in line with the birthdays. Resolves to
 * `{ created, updated, removed, failed, error }`; one failed change doesn't
 * stop the others. `beat` is called before each change (to renew a lock).
 */
export async function syncCalendar(api, { birthdays, today, enabled, beat = null }) {
  const events = await loadManagedEvents(api, today);
  const plan = planSync({ birthdays, events, today, enabled, i18n: api.i18n });
  const result = { created: 0, updated: 0, removed: 0, failed: 0, error: null };
  const attempt = async (fn, field) => {
    try {
      if (beat) await beat();
      const ok = await fn();
      if (ok === null) throw new Error('the calendar refused the change');
      result[field] += 1;
    } catch (err) {
      result.failed += 1;
      result.error ??= err;
      api.log.warn('calendar change failed', err);
    }
  };
  for (const id of plan.remove) await attempt(() => api.calendar.deleteEvent(id), 'removed');
  for (const { id, patch } of plan.update) await attempt(() => api.calendar.updateEvent(id, patch), 'updated');
  for (const { event } of plan.create) await attempt(() => api.calendar.createEvent(event), 'created');
  return result;
}
