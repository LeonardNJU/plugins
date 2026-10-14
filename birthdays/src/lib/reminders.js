// Which birthday reminders are due, and the notifications for them.
//
// Two reminders per birthday: one when it comes within `daysBefore` days
// (the first day the app is open in that window), one on the day. What was
// sent is remembered per contact, so each contact gets at most one
// reminder a day, and the early one only once per birthday.

import { ageIn, daysBetween, nextOccurrence } from './dates.js';
import { ageText, monthDay, relativeDays } from './format.js';

/** More reminders than this at once become one summary notification. */
export const MAX_SEPARATE = 3;

/**
 * Reminders due today: `[{ ...birthday, date, daysUntil, age, kind }]`,
 * kind 'today' or 'soon'. `sent` is the stored record
 * `{ [key]: { last, soon, today } }` (dates).
 */
export function dueReminders(birthdays, today, settings, sent = {}) {
  if (!settings.notify) return [];
  const due = [];
  for (const b of birthdays) {
    const next = nextOccurrence(b, today);
    const daysUntil = daysBetween(today, next.date);
    const record = sent[b.key] ?? {};
    if (record.last === today) continue;
    let kind = null;
    if (daysUntil === 0 && record.today !== next.date) kind = 'today';
    else if (daysUntil > 0 && daysUntil <= settings.daysBefore && record.soon !== next.date) kind = 'soon';
    if (kind) due.push({ ...b, date: next.date, daysUntil, age: ageIn(b, next.year), kind });
  }
  due.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
  return due;
}

/**
 * The record after sending `reminders` today. Entries of contacts that are
 * gone, and of birthdays long past, are dropped so storage stays small.
 */
export function markSent(sent, reminders, today, birthdays) {
  const keep = new Set(birthdays.map((b) => b.key));
  const next = {};
  for (const [key, record] of Object.entries(sent ?? {})) {
    if (!keep.has(key)) continue;
    const latest = [record.today, record.soon, record.last].filter(Boolean).sort().at(-1);
    if (latest && daysBetween(latest, today) > 40) continue;
    next[key] = { ...record };
  }
  for (const r of reminders) {
    next[r.key] = { ...(next[r.key] ?? {}), last: today, [r.kind]: r.date };
  }
  return next;
}

/** A notification tag for a contact: 1-64 of letters, digits and `. _ : -`. */
export function tagFor(key) {
  return `bday:${String(key).replace(/[^A-Za-z0-9._-]/g, '_')}`.slice(0, 64);
}

/** The birthday a notification tag belongs to, or null. */
export function birthdayForTag(birthdays, tag) {
  if (typeof tag !== 'string' || !tag.startsWith('bday:')) return null;
  return birthdays.find((b) => tagFor(b.key) === tag) ?? null;
}

function bodyFor(reminder, i18n) {
  const locale = i18n.getLocale ? i18n.getLocale() : 'en';
  const parts = [monthDay(reminder.date, locale)];
  if (reminder.age) parts.push(ageText(reminder.age, i18n));
  return parts.join(' · ');
}

/** The notifications to show for the due reminders. */
export function notificationsFor(reminders, i18n) {
  const locale = i18n.getLocale ? i18n.getLocale() : 'en';
  if (reminders.length > MAX_SEPARATE) {
    const today = reminders.filter((r) => r.kind === 'today');
    const soon = reminders.filter((r) => r.kind === 'soon');
    const out = [];
    if (today.length) {
      out.push({ title: i18n.t('notify.manyToday', { names: today.map((r) => r.name).join(', ') }), tag: 'bday-today' });
    }
    if (soon.length) {
      out.push({ title: i18n.t('notify.manySoon', { names: soon.map((r) => r.name).join(', ') }), tag: 'bday-soon' });
    }
    return out.map((n) => ({ ...n, title: n.title.length > 120 ? `${n.title.slice(0, 119)}…` : n.title }));
  }
  return reminders.map((r) => {
    const title = r.kind === 'today'
      ? i18n.t('notify.today', { name: r.name })
      : i18n.t('notify.soon', { name: r.name, when: relativeDays(r.daysUntil, locale) });
    return {
      title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
      body: bodyFor(r, i18n),
      tag: tagFor(r.key),
    };
  });
}
