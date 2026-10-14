// Birthday dates: reading them from contacts and working out when the next
// one is. Dates are plain `YYYY-MM-DD` strings in the user's local calendar;
// nothing here depends on a time zone.

const DAY_MS = 86_400_000;

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month, year) {
  // Without a year, February 29 is a real birthday.
  if (month === 2) return year === null || isLeapYear(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function valid(year, month, day) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(month, year)) return null;
  if (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)) return null;
  return { year, month, day };
}

/**
 * A birthday as `{ year, month, day }` (year null when unknown), or null.
 * Takes what contacts carry: `--MM-DD`, `--MMDD`, `YYYY-MM-DD`, `YYYYMMDD`
 * (optionally followed by a time), a JSContact PartialDate
 * `{ year?, month, day }` or a Timestamp `{ '@type': 'Timestamp', utc }`.
 */
export function parseBirthdayDate(value) {
  if (typeof value === 'string') {
    const s = value.trim();
    let m = /^--(\d{2})-?(\d{2})$/.exec(s);
    if (m) return valid(null, +m[1], +m[2]);
    m = /^(\d{4})-?(\d{2})-?(\d{2})(?:$|T)/.exec(s);
    if (m) return valid(+m[1], +m[2], +m[3]);
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (value['@type'] === 'Timestamp') return parseBirthdayDate(String(value.utc ?? '').slice(0, 10));
  if (value.calendarScale && String(value.calendarScale).toLowerCase() !== 'gregorian') return null;
  const year = value.year === undefined || value.year === null ? null : value.year;
  return valid(year, value.month, value.day);
}

const pad = (n, len = 2) => String(n).padStart(len, '0');

export function isoDate(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Today in the user's local calendar. */
export function localToday(now = new Date()) {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function toUtcMs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso, days) {
  const date = new Date(toUtcMs(iso) + days * DAY_MS);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso, toIso) {
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / DAY_MS);
}

/**
 * The day the birthday is celebrated in `year`. Someone born on February 29
 * celebrates on February 28 in years without that day.
 */
export function occurrenceIn(birthday, year) {
  if (birthday.month === 2 && birthday.day === 29 && !isLeapYear(year)) return isoDate(year, 2, 28);
  return isoDate(year, birthday.month, birthday.day);
}

/** The next time the birthday is celebrated, today included: `{ date, year }`. */
export function nextOccurrence(birthday, today) {
  const year = Number(today.slice(0, 4));
  const thisYear = occurrenceIn(birthday, year);
  if (thisYear >= today) return { date: thisYear, year };
  return { date: occurrenceIn(birthday, year + 1), year: year + 1 };
}

/** The age reached on the birthday in `year`, or null when the birth year is unknown. */
export function ageIn(birthday, year) {
  if (birthday.year === null || birthday.year === undefined) return null;
  const age = year - birthday.year;
  return age > 0 ? age : null;
}
