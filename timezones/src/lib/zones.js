// Time zone math with Intl only: offsets, wall clocks, local time to instant
// (with the DST gap and overlap handled the way calendars do), and turning
// what a user typed ("Berlin, New York") into IANA zone ids.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const partsFormatters = new Map();

function partsFormatter(zone) {
  let f = partsFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFormatters.set(zone, f);
  }
  return f;
}

/** True when Intl knows `zone` as a time zone id. */
export function isValidZone(zone) {
  if (typeof zone !== 'string' || !zone) return false;
  try {
    partsFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `zone` at `instant` (ms), as numbers. */
export function wallClock(instant, zone) {
  const parts = {};
  for (const p of partsFormatter(zone).formatToParts(new Date(instant))) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Minutes east of UTC in `zone` at `instant` (Berlin in summer: 120). */
export function offsetMinutes(zone, instant) {
  const w = wallClock(instant, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const whole = Math.floor(instant / 1000) * 1000;
  return Math.round((asUtc - whole) / MINUTE);
}

/** "UTC", "UTC+2", "UTC−5", "UTC+5:30" (with a real minus sign). */
export function formatOffset(minutes) {
  if (!minutes) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Parse "2026-10-14T15:00" into numbers, or null. */
export function parseLocal(text) {
  const m = LOCAL_RE.exec(String(text ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return { year: y, month: mo, day: d, hour: h, minute: mi, second: s || 0 };
}

function sameWall(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/**
 * The instant at which the wall clock in `zone` reads `local`
 * ("2026-10-14T15:00" or the parsed fields). A time that occurs twice (the
 * hour when clocks go back) gives the earlier one; a time that doesn't exist
 * (the hour skipped when clocks go forward) moves forward by the gap, so
 * 02:30 on the spring change in Berlin becomes 03:30. Same as RFC 5545 and
 * Temporal's "compatible". Returns NaN for unreadable input.
 */
export function zonedToInstant(local, zone) {
  const f = typeof local === 'string' ? parseLocal(local) : local;
  if (!f) return NaN;
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second || 0);
  const before = offsetMinutes(zone, asUtc - DAY);
  const after = offsetMinutes(zone, asUtc + DAY);
  const candidates = [...new Set([before, after])]
    .map((off) => asUtc - off * MINUTE)
    .filter((t) => sameWall(wallClock(t, zone), f))
    .sort((a, b) => a - b);
  if (candidates.length) return candidates[0];
  // In the gap: read the clock with the offset from before the change.
  return asUtc - before * MINUTE;
}

/** Minutes since local midnight in `zone`. */
export function minutesOfDay(instant, zone) {
  const w = wallClock(instant, zone);
  return w.hour * 60 + w.minute;
}

/** "2026-10-14" in `zone`. */
export function localDate(instant, zone) {
  const w = wallClock(instant, zone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Whole days `zone`'s date is ahead of `homeZone`'s date at `instant` (-1, 0, 1). */
export function dayShift(instant, zone, homeZone) {
  const a = Date.parse(`${localDate(instant, zone)}T00:00:00Z`);
  const b = Date.parse(`${localDate(instant, homeZone)}T00:00:00Z`);
  return Math.round((a - b) / DAY);
}

/**
 * Whether the time from `start` to `end` (ms) lies outside working hours in
 * `zone`: it starts before `fromHour`, ends after `toHour`, or runs over
 * midnight. An end of exactly `toHour` is fine.
 */
export function isOutsideHours(start, end, zone, fromHour = 8, toHour = 20) {
  const s = minutesOfDay(start, zone);
  const stop = Number.isFinite(end) && end > start ? end : start;
  let e = minutesOfDay(stop, zone);
  const days = Math.round((Date.parse(`${localDate(stop, zone)}T00:00:00Z`) - Date.parse(`${localDate(start, zone)}T00:00:00Z`)) / DAY);
  // Ending at local midnight is the end of the same day.
  if (days === 1 && e === 0) e = 24 * 60;
  else if (days !== 0) return true;
  return s < fromHour * 60 || s >= toHour * 60 || e > toHour * 60;
}

// ─── Names ─────────────────────────────────────────────────────

/** "America/New_York" → "New York", "Etc/UTC" → "UTC". */
export function zoneCity(zone) {
  if (!zone) return '';
  if (/^(Etc\/)?(UTC|GMT|UCT|Zulu|Universal)$/i.test(zone)) return 'UTC';
  const last = zone.split('/').pop() || zone;
  return last.replace(/_/g, ' ');
}

let allZones = null;

/** Every zone id this browser knows. */
export function knownZones() {
  if (allZones) return allZones;
  try {
    allZones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    allZones = [];
  }
  if (!allZones.includes('UTC')) allZones = [...allZones, 'UTC'];
  return allZones;
}

function fold(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

// Common names that are not the last part of an IANA id.
const ALIASES = {
  'utc': 'UTC', 'gmt': 'UTC', 'z': 'UTC',
  'san francisco': 'America/Los_Angeles', 'seattle': 'America/Los_Angeles', 'silicon valley': 'America/Los_Angeles',
  'washington': 'America/New_York', 'boston': 'America/New_York', 'miami': 'America/New_York', 'atlanta': 'America/New_York',
  'houston': 'America/Chicago', 'dallas': 'America/Chicago', 'austin': 'America/Chicago',
  'munich': 'Europe/Berlin', 'muenchen': 'Europe/Berlin', 'munchen': 'Europe/Berlin', 'hamburg': 'Europe/Berlin', 'frankfurt': 'Europe/Berlin', 'cologne': 'Europe/Berlin', 'koln': 'Europe/Berlin',
  'zurich': 'Europe/Zurich', 'geneva': 'Europe/Zurich',
  'mumbai': 'Asia/Kolkata', 'bombay': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', 'bangalore': 'Asia/Kolkata', 'bengaluru': 'Asia/Kolkata', 'calcutta': 'Asia/Kolkata',
  'beijing': 'Asia/Shanghai', 'peking': 'Asia/Shanghai', 'shenzhen': 'Asia/Shanghai',
  'saigon': 'Asia/Ho_Chi_Minh', 'ho chi minh city': 'Asia/Ho_Chi_Minh',
  'kyiv': 'Europe/Kyiv', 'kiev': 'Europe/Kyiv',
  'sao paulo': 'America/Sao_Paulo', 'rio de janeiro': 'America/Sao_Paulo', 'rio': 'America/Sao_Paulo',
  'mexico city': 'America/Mexico_City',
  'tel aviv': 'Asia/Jerusalem',
  'abu dhabi': 'Asia/Dubai',
  'osaka': 'Asia/Tokyo',
  'canberra': 'Australia/Sydney',
  'wellington': 'Pacific/Auckland',
};

/**
 * Turn one entry a user typed into a zone id: an IANA id in any case
 * ("europe/berlin"), a city from one ("new york", "Ho Chi Minh") or a
 * common alias ("Munich", "San Francisco"). Returns null when unknown.
 */
export function resolveZone(entry) {
  const raw = String(entry ?? '').trim();
  if (!raw) return null;
  const zones = knownZones();
  const exact = zones.find((z) => z.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  if (raw.includes('/') && isValidZone(raw)) return canonical(raw);
  const key = fold(raw);
  if (ALIASES[key]) return ALIASES[key];
  const byCity = zones.find((z) => fold(zoneCity(z)) === key);
  if (byCity) return byCity;
  return null;
}

function canonical(zone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone || zone;
  } catch {
    return zone;
  }
}

/**
 * Split a list the user typed ("Berlin, New York; Asia/Tokyo") into zone
 * ids, in order, without duplicates. Entries that are no zone come back in
 * `unknown` so the settings page can point them out.
 */
export function parseZoneList(text) {
  const zones = [];
  const unknown = [];
  for (const part of String(text ?? '').split(/[,;\n]+/)) {
    const entry = part.trim();
    if (!entry) continue;
    const zone = resolveZone(entry);
    if (!zone) unknown.push(entry);
    else if (!zones.includes(zone)) zones.push(zone);
  }
  return { zones, unknown };
}

// ─── Formatting ───────────────────────────────────────────────

const timeFormatters = new Map();

/** "15:00" or "3:00 PM", the way `locale` writes times, in `zone`. */
export function formatTime(instant, zone, locale = 'en') {
  const key = `${locale}|${zone}`;
  let f = timeFormatters.get(key);
  if (!f) {
    let tag = locale;
    try {
      new Intl.DateTimeFormat(tag);
    } catch {
      tag = 'en';
    }
    // "15:00" where clocks run to 24, "3:00 PM" (not "03:00 PM") elsewhere.
    const twelve = new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hour12 === true;
    f = new Intl.DateTimeFormat(tag, { timeZone: zone, hour: twelve ? 'numeric' : '2-digit', minute: '2-digit' });
    timeFormatters.set(key, f);
  }
  return f.format(new Date(instant));
}

/** Short weekday ("Tue", "Di.") in `zone`. */
export function formatWeekday(instant, zone, locale = 'en') {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'short' }).format(new Date(instant));
  } catch {
    return new Intl.DateTimeFormat('en', { timeZone: zone, weekday: 'short' }).format(new Date(instant));
  }
}

/**
 * One line naming a moment in several zones: "15:00 Berlin / 09:00 New York".
 * When the zones are not all on the same date, each time gets its weekday
 * ("Tue 23:00 Berlin / Wed 06:00 Tokyo") so nobody reads the wrong day.
 */
export function formatMultiZone(instant, zones, locale = 'en') {
  const list = zones.filter(isValidZone);
  if (!list.length) return '';
  const dates = new Set(list.map((z) => localDate(instant, z)));
  const withDay = dates.size > 1;
  return list
    .map((z) => `${withDay ? `${formatWeekday(instant, z, locale)} ` : ''}${formatTime(instant, z, locale)} ${zoneCity(z)}`)
    .join(' / ');
}

/** The zone this browser runs in, or UTC. */
export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
