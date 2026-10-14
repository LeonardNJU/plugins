import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { birthdayForTag, dueReminders, markSent, notificationsFor, tagFor } from '../src/lib/reminders.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const i18n = (locale = 'en') => fakeApi({ locale, translations: manifest.locales }).i18n;

const on = { notify: true, daysBefore: 3 };
const ada = { key: 'ada', name: 'Ada', year: 1990, month: 10, day: 14 };
const ben = { key: 'ben', name: 'Ben', year: null, month: 10, day: 16 };
const cy = { key: 'cy', name: 'Cy', year: null, month: 10, day: 20 };

describe('dueReminders', () => {
  it('reminds on the day and within the days before, not further out', () => {
    const due = dueReminders([cy, ben, ada], '2026-10-14', on, {});
    expect(due.map((r) => [r.key, r.kind, r.daysUntil])).toEqual([['ada', 'today', 0], ['ben', 'soon', 2]]);
    expect(due[0].age).toBe(36);
  });

  it('sends nothing when reminders are off, and only the day one with 0 days before', () => {
    expect(dueReminders([ada, ben], '2026-10-14', { notify: false, daysBefore: 3 }, {})).toEqual([]);
    expect(dueReminders([ada, ben], '2026-10-14', { notify: true, daysBefore: 0 }, {}).map((r) => r.key)).toEqual(['ada']);
  });

  it('reminds each contact at most once a day', () => {
    const sent = markSent({}, dueReminders([ada, ben], '2026-10-14', on, {}), '2026-10-14', [ada, ben]);
    expect(dueReminders([ada, ben], '2026-10-14', on, sent)).toEqual([]);
  });

  it('does not remind twice on one day when the birthday is moved to today', () => {
    const sent = markSent({}, dueReminders([ben], '2026-10-14', on, {}), '2026-10-14', [ben]);
    const moved = { ...ben, day: 14 };
    expect(dueReminders([moved], '2026-10-14', on, sent)).toEqual([]);
    expect(dueReminders([moved], '2027-10-14', on, sent).map((r) => r.kind)).toEqual(['today']);
  });

  it('sends the early reminder once per birthday, then the one on the day', () => {
    let sent = {};
    const days = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
    const log = [];
    for (const day of days) {
      const due = dueReminders([ben], day, on, sent);
      log.push(...due.map((r) => `${day}:${r.kind}`));
      sent = markSent(sent, due, day, [ben]);
    }
    expect(log).toEqual(['2026-10-13:soon', '2026-10-16:today']);
  });

  it('reminds again the next year', () => {
    let sent = markSent({}, dueReminders([ada], '2026-10-14', on, {}), '2026-10-14', [ada]);
    expect(dueReminders([ada], '2027-10-12', on, sent).map((r) => r.kind)).toEqual(['soon']);
    sent = markSent(sent, dueReminders([ada], '2027-10-12', on, sent), '2027-10-12', [ada]);
    expect(dueReminders([ada], '2027-10-14', on, sent).map((r) => r.kind)).toEqual(['today']);
  });

  it('reminds a February 29 birthday on February 28 in other years', () => {
    const leap = { key: 'leap', name: 'Leap', year: null, month: 2, day: 29 };
    expect(dueReminders([leap], '2027-02-28', on, {}).map((r) => r.kind)).toEqual(['today']);
    expect(dueReminders([leap], '2027-03-01', on, {})).toEqual([]);
  });
});

describe('markSent', () => {
  it('forgets deleted contacts and long-past birthdays', () => {
    const sent = { gone: { last: '2026-10-01' }, old: { last: '2026-01-01', today: '2026-01-01' }, ada: { last: '2026-10-10', soon: '2026-10-14' } };
    const old = { key: 'old', name: 'Old', year: null, month: 1, day: 1 };
    expect(markSent(sent, [], '2026-10-14', [ada, old])).toEqual({ ada: { last: '2026-10-10', soon: '2026-10-14' } });
  });
});

describe('notifications', () => {
  it('names the contact, the day and the age', () => {
    const [today, soon] = notificationsFor(dueReminders([ada, ben], '2026-10-14', on, {}), i18n());
    expect(today).toEqual({ title: 'It’s Ada’s birthday today', body: 'October 14 · turns 36', tag: 'bday:ada' });
    expect(soon).toEqual({ title: 'Ben’s birthday is in 2 days', body: 'October 16', tag: 'bday:ben' });
  });

  it('speaks the user language', () => {
    const [n] = notificationsFor(dueReminders([ben], '2026-10-15', on, {}), i18n('de'));
    expect(n.title).toBe('Ben hat morgen Geburtstag');
    expect(n.body).toBe('16. Oktober');
  });

  it('sums up many birthdays in one notification per kind, within the host limit', () => {
    const people = Array.from({ length: 5 }, (_, i) => ({ key: `p${i}`, name: `Person ${i}`, year: null, month: 10, day: 14 + (i % 2) }));
    const list = notificationsFor(dueReminders(people, '2026-10-14', on, {}), i18n());
    expect(list).toEqual([
      { title: 'Birthdays today: Person 0, Person 2, Person 4', tag: 'bday-today' },
      { title: 'Birthdays coming up: Person 1, Person 3', tag: 'bday-soon' },
    ]);
  });

  it('makes tags the host accepts and finds the contact again', () => {
    const odd = { key: 'urn:uuid:Ä b/c', name: 'Odd' };
    expect(tagFor(odd.key)).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    expect(tagFor('x'.repeat(100))).toHaveLength(64);
    expect(birthdayForTag([ada, odd], tagFor(odd.key))).toBe(odd);
    expect(birthdayForTag([ada], 'something-else')).toBeNull();
  });
});
