// The sender's local time for the open message.

import { findDateHeader, parseDateHeader, senderClock } from './date-header.js';
import { zoneFor } from './address-zones.js';
import { formatOffset, formatTime, offsetMinutes } from './zones.js';

/**
 * @param email  EmailReadView (needs `headers`; `from` for a saved zone)
 * @param opts   { home, addressZones, locale, now }
 * @returns null when the message has no Date header with a known offset,
 *   else { sent, yours, offset, sameAsYours, address, savedZone, nowThere }
 *   sent: "23:40" as the sender's clock read; yours: the same moment on
 *   your clock (in `home`, else the browser's zone); offset: "UTC−5";
 *   nowThere: the time now in the zone saved for the sender, or null.
 */
export function senderTime(email, { home, addressZones = {}, locale = 'en', now = Date.now() } = {}) {
  if (!email) return null;
  const parsed = parseDateHeader(findDateHeader(email.headers));
  const clock = senderClock(parsed);
  if (!clock) return null;
  const address = Array.isArray(email.from) && email.from[0]?.email ? email.from[0].email : null;
  const savedZone = address ? zoneFor(addressZones, address) : null;
  return {
    sent: formatTime(clock.shifted, 'UTC', locale),
    yours: formatTime(parsed.instant, home || undefined, locale),
    offsetMinutes: parsed.offsetMinutes,
    offset: formatOffset(parsed.offsetMinutes),
    sameAsYours: home ? offsetMinutes(home, parsed.instant) === parsed.offsetMinutes : false,
    address,
    savedZone,
    nowThere: savedZone ? formatTime(now, savedZone, locale) : null,
  };
}

/**
 * Whether the line under the subject should appear: not when the sender's
 * clock matched yours and no other zone is saved for them (nothing to tell).
 */
export function worthShowing(info, home) {
  return !!info && (!info.sameAsYours || (!!info.savedZone && info.savedZone !== home));
}
