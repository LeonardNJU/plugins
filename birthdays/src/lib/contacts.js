// Turning contacts into birthdays. Works with both shapes the host hands
// out: JSContact cards from api.contacts.list (anniversaries as a map of
// `{ kind: 'birth', date: PartialDate | string }`) and the ContactView of
// the contact hooks (anniversaries as `[{ kind, date: '--MM-DD' }]`).

import { ageIn, daysBetween, nextOccurrence, parseBirthdayDate } from './dates.js';

const BIRTH_KINDS = new Set(['birth', 'birthday', 'bday']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** The name to show for a contact. */
export function contactName(card) {
  if (!card || typeof card !== 'object') return '';
  const name = card.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  if (name && typeof name === 'object') {
    if (text(name.full)) return text(name.full);
    const parts = Array.isArray(name.components) ? name.components : Object.values(name.components ?? {});
    const given = parts.filter((p) => p?.kind === 'given').map((p) => text(p.value)).filter(Boolean);
    const surname = parts.filter((p) => p?.kind === 'surname').map((p) => text(p.value)).filter(Boolean);
    const joined = [...given, ...surname].join(' ');
    if (joined) return joined;
  }
  if (text(card.fullName)) return text(card.fullName);
  const viewName = [text(card.firstName), text(card.lastName)].filter(Boolean).join(' ');
  if (viewName) return viewName;
  const nick = Object.values(card.nicknames ?? {}).map((n) => text(n?.name)).find(Boolean);
  if (nick) return nick;
  return primaryEmail(card) ?? '';
}

/** The first name, for greetings: the given name, else the first word of the name. */
export function contactFirstName(card) {
  const parts = card?.name && typeof card.name === 'object'
    ? (Array.isArray(card.name.components) ? card.name.components : Object.values(card.name.components ?? {}))
    : [];
  const given = parts.find((p) => p?.kind === 'given' && text(p.value));
  if (given) return text(given.value);
  if (text(card?.firstName)) return text(card.firstName);
  const full = contactName(card);
  if (full.includes('@')) return '';
  return full.split(/\s+/)[0] ?? '';
}

/** The preferred email address of a contact, or null. */
export function primaryEmail(card) {
  if (!card) return null;
  if (Array.isArray(card.emails)) {
    const first = card.emails.map((e) => (typeof e === 'string' ? e : e?.address)).find((a) => text(a).includes('@'));
    return first ? text(first) : null;
  }
  const entries = Object.values(card.emails ?? {}).filter((e) => text(e?.address).includes('@'));
  if (!entries.length) return null;
  entries.sort((a, b) => (a.pref ?? 101) - (b.pref ?? 101));
  return text(entries[0].address);
}

function birthEntries(card) {
  const list = Array.isArray(card.anniversaries) ? card.anniversaries : Object.values(card.anniversaries ?? {});
  return list.filter((a) => a && BIRTH_KINDS.has(String(a.kind ?? '').toLowerCase()));
}

/**
 * One birthday per contact that has one: `{ key, contactId, name, firstName,
 * email, year, month, day }`. `key` is the contact id, which stays the same
 * when the contact is edited. Groups, contacts without a readable birthday
 * and repeated ids are left out.
 */
export function birthdaysFromContacts(cards) {
  const out = [];
  const seen = new Set();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || typeof card.id !== 'string' || !card.id || seen.has(card.id)) continue;
    if (card.kind === 'group' || card.kind === 'org') continue;
    let date = null;
    for (const entry of birthEntries(card)) {
      date = parseBirthdayDate(entry.date);
      if (date) break;
    }
    if (!date) continue;
    seen.add(card.id);
    out.push({
      key: card.id,
      contactId: card.id,
      name: contactName(card),
      firstName: contactFirstName(card),
      email: primaryEmail(card),
      ...date,
    });
  }
  return out;
}

/**
 * Birthdays in the next `withinDays` days (today counts as day 0), soonest
 * first, each with `date`, `daysUntil` and `age` (null without a birth year).
 */
export function upcomingBirthdays(birthdays, today, withinDays) {
  const out = [];
  for (const b of birthdays) {
    const next = nextOccurrence(b, today);
    const daysUntil = daysBetween(today, next.date);
    if (daysUntil > withinDays) continue;
    out.push({ ...b, date: next.date, daysUntil, age: ageIn(b, next.year) });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
  return out;
}
