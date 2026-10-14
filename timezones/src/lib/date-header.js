// Reading the sender's clock from a message's Date header (RFC 5322 3.3).
// The header keeps the sender's UTC offset ("Tue, 14 Oct 2026 23:40:00
// -0500"), which is all we know about where they were when they wrote it.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Obsolete zone names RFC 5322 4.3 still asks readers to understand.
const NAMED_ZONES = {
  ut: 0, gmt: 0, z: 0,
  est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420,
};

/** The Date header from a parsed header map, whatever its case. */
export function findDateHeader(headers) {
  if (!headers || typeof headers !== 'object') return null;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'date') continue;
    const v = Array.isArray(value) ? value[0] : value;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * Parse a Date header value. Returns `{ instant, offsetMinutes }` or null.
 * `offsetMinutes` is null when the header says the zone is unknown ("-0000"
 * or a military letter), in which case nobody can tell the sender's clock.
 */
export function parseDateHeader(value) {
  if (typeof value !== 'string') return null;
  // Drop comments like "(CET)", then squeeze whitespace (which also unfolds).
  let text = value;
  for (let i = 0; i < 3 && /\([^()]*\)/.test(text); i++) text = text.replace(/\([^()]*\)/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  // Optional day name.
  text = text.replace(/^[A-Za-z]{3,9},?\s*/, '');
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+([+-]\d{4}|[A-Za-z]{1,5}))?$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  let year = Number(m[3]);
  if (m[3].length === 2) year += year < 50 ? 2000 : 1900;
  else if (m[3].length === 3) year += 1900;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || 0);
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;

  let offsetMinutes = null;
  const zone = m[7];
  if (!zone) {
    offsetMinutes = null;
  } else if (/^[+-]\d{4}$/.test(zone)) {
    const sign = zone[0] === '-' ? -1 : 1;
    const hh = Number(zone.slice(1, 3));
    const mm = Number(zone.slice(3, 5));
    if (hh > 23 || mm > 59) return null;
    // "-0000" means "the zone is not known" (RFC 5322 3.3).
    offsetMinutes = zone === '-0000' ? null : sign * (hh * 60 + mm);
  } else {
    const named = NAMED_ZONES[zone.toLowerCase()];
    offsetMinutes = named === undefined ? null : named;
  }

  const wall = Date.UTC(year, month, day, hour, minute, Math.min(second, 59));
  const instant = wall - (offsetMinutes ?? 0) * 60_000;
  return { instant, offsetMinutes };
}

/**
 * What the sender's clock read: hours and minutes of the instant shifted by
 * their offset, and the shifted date ("2026-10-14").
 */
export function senderClock(parsed) {
  if (!parsed || parsed.offsetMinutes === null) return null;
  const shifted = new Date(parsed.instant + parsed.offsetMinutes * 60_000);
  return {
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10),
    shifted: shifted.getTime(),
  };
}
