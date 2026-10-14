// What the event form shows: the event's time in each participant's zone
// (the zone set for their address) and in the user's favourite zones, and
// which of those fall outside working hours.

import { zoneFor } from './address-zones.js';
import { dayShift, formatTime, isOutsideHours, isValidZone, zoneCity, zonedToInstant } from './zones.js';

/** Milliseconds of an ISO 8601 duration ("PT1H30M", "P1DT2H", "P1W"), or NaN. */
export function parseDuration(text) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(text ?? ''));
  if (!m || text === 'P' || text === 'PT') return NaN;
  const [, w, d, h, mi, sec] = m.map((v) => Number(v || 0));
  return ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + sec) * 1000;
}

/**
 * The event in one shape, from either the event form section
 * (CalendarEventView: start, duration, timeZone, participants) or the form
 * values the conflict hook gets (start, end, attendees).
 */
export function normaliseEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const attendees = Array.isArray(e.attendees)
    ? e.attendees.filter((a) => typeof a === 'string')
    : Array.isArray(e.participants) ? e.participants.map((p) => p?.email).filter((a) => typeof a === 'string' && a) : [];
  return {
    start: e.start,
    end: typeof e.end === 'string' ? e.end : null,
    duration: typeof e.duration === 'string' ? e.duration : null,
    zone: isValidZone(e.timeZone) ? e.timeZone : null,
    isAllDay: !!e.isAllDay,
    attendees,
  };
}

/**
 * @param eventData  the event (see normaliseEvent). Its times are in its own
 *   time zone when it names one, else in the user's.
 * @param settings   from readSettings()
 * @param addressZones  address → zone
 * @returns {{ allDay, start, end, rows, missing, warnings }} or null when the
 *   form has no readable start time.
 *   rows: [{ zone, emails: [], favourite, start, end, outside, dayShift }]
 *   (one per zone; the user's own zone is not a row)
 *   missing: participant addresses without a zone
 *   warnings: participant rows that are outside working hours
 */
export function eventZones(eventData, settings, addressZones) {
  const ev = normaliseEvent(eventData);
  if (!ev) return null;
  const home = settings.home;
  const evZone = ev.zone ?? home;
  const start = zonedToInstant(ev.start, evZone);
  if (!Number.isFinite(start)) return null;
  let end = ev.end ? zonedToInstant(ev.end, evZone) : start + parseDuration(ev.duration);
  if (!Number.isFinite(end) || end < start) end = start;

  // Participants first, then favourites in the order the user gave them.
  const byZone = new Map();
  const missing = [];
  for (const address of ev.attendees) {
    const zone = zoneFor(addressZones, address);
    if (!zone) {
      if (address) missing.push(address);
      continue;
    }
    if (zone === home) continue;
    const row = byZone.get(zone) ?? { zone, emails: [], favourite: false };
    row.emails.push(address);
    byZone.set(zone, row);
  }
  for (const zone of settings.favourites) {
    const row = byZone.get(zone) ?? { zone, emails: [], favourite: false };
    row.favourite = true;
    byZone.set(zone, row);
  }

  const allDay = ev.isAllDay;
  const rows = [...byZone.values()].map((row) => ({
    ...row,
    start,
    end,
    outside: !allDay && isOutsideHours(start, end, row.zone, settings.workStart, settings.workEnd),
    dayShift: dayShift(start, row.zone, evZone),
  }));
  return {
    allDay,
    start,
    end,
    rows,
    missing,
    // Only participants get a warning; favourites just show the time.
    warnings: rows.filter((r) => r.outside && r.emails.length > 0),
  };
}

/** "08:00" / "8:00 AM" for a whole hour, the way `locale` writes times. */
export function hourLabel(hour, locale) {
  return formatTime(Date.UTC(2026, 0, 1, hour % 24, 0), 'UTC', locale);
}

/**
 * The warning for the event form (onCheckEventConflicts), or null:
 * "Outside 08:00–20:00 for bob@example.org (Chicago)".
 */
export function outsideHoursWarning(info, settings, t, locale) {
  if (!info || info.allDay || info.warnings.length === 0) return null;
  const names = info.warnings.map((r) => `${r.emails.join(', ')} (${zoneCity(r.zone)})`).join('; ');
  return {
    key: 'timezones-outside-hours',
    severity: 'warning',
    message: t('event.warning', { from: hourLabel(settings.workStart, locale), to: hourLabel(settings.workEnd, locale), names }),
  };
}
