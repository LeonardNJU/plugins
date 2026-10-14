// The "time in several zones" text for the composer.

import { formatMultiZone, localDate, wallClock, zonedToInstant } from './zones.js';

/** The next full hour after `now`, as "YYYY-MM-DD" and "HH:MM" in `zone`. */
export function nextFullHour(now, zone) {
  const w = wallClock(now, zone);
  const base = zonedToInstant({ ...w, minute: 0, second: 0 }, zone);
  const next = base + 3_600_000;
  const n = wallClock(next, zone);
  return { date: localDate(next, zone), time: `${String(n.hour).padStart(2, '0')}:${String(n.minute).padStart(2, '0')}` };
}

/**
 * The line to paste: the time picked in `fromZone`, written in each of
 * `zones` in order ("15:00 Berlin / 09:00 New York"). Empty when the date
 * or time can't be read or no zone is picked.
 */
export function composeLine({ date, time, fromZone, zones, locale = 'en' }) {
  if (!zones || !zones.length) return '';
  const instant = zonedToInstant(`${date}T${time}`, fromZone);
  if (!Number.isFinite(instant)) return '';
  return formatMultiZone(instant, zones, locale);
}
