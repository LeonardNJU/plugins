import { describe, expect, it } from 'vitest';
import { birthdaysFromContacts, contactFirstName, contactName, primaryEmail, upcomingBirthdays } from '../src/lib/contacts.js';

const card = (id, extra = {}) => ({ id, addressBookIds: { b: true }, kind: 'individual', ...extra });
const birth = (date) => ({ anniversaries: { a1: { '@type': 'Anniversary', kind: 'birth', date } } });

describe('contact names and addresses', () => {
  it('uses the full name, else the name parts, else the address', () => {
    expect(contactName(card('1', { name: { full: 'Ada Lovelace' } }))).toBe('Ada Lovelace');
    expect(contactName(card('2', { name: { components: [{ kind: 'given', value: 'Grace' }, { kind: 'surname', value: 'Hopper' }] } })))
      .toBe('Grace Hopper');
    expect(contactName(card('3', { emails: { e: { address: 'x@example.org' } } }))).toBe('x@example.org');
    expect(contactName({ id: '4', fullName: 'From a view' })).toBe('From a view');
  });

  it('takes the given name for greetings, else the first word', () => {
    expect(contactFirstName(card('1', { name: { full: 'Ada Lovelace', components: [{ kind: 'given', value: 'Augusta Ada' }] } })))
      .toBe('Augusta Ada');
    expect(contactFirstName(card('2', { name: { full: 'Ada Lovelace' } }))).toBe('Ada');
    expect(contactFirstName(card('3', { emails: { e: { address: 'x@example.org' } } }))).toBe('');
  });

  it('picks the preferred address', () => {
    expect(primaryEmail(card('1', { emails: { a: { address: 'second@x.org', pref: 2 }, b: { address: 'first@x.org', pref: 1 } } })))
      .toBe('first@x.org');
    expect(primaryEmail(card('2', { emails: ['view@x.org'] }))).toBe('view@x.org');
    expect(primaryEmail(card('3'))).toBeNull();
  });
});

describe('birthdaysFromContacts', () => {
  it('reads birthdays from JSContact cards and from contact views', () => {
    const list = birthdaysFromContacts([
      card('a', { name: { full: 'Ada' }, ...birth({ '@type': 'PartialDate', year: 1990, month: 5, day: 3 }) }),
      { id: 'v', fullName: 'View', emails: ['v@x.org'], anniversaries: [{ kind: 'birth', date: '--07-01' }] },
    ]);
    expect(list).toEqual([
      { key: 'a', contactId: 'a', name: 'Ada', firstName: 'Ada', email: null, year: 1990, month: 5, day: 3 },
      { key: 'v', contactId: 'v', name: 'View', firstName: 'View', email: 'v@x.org', year: null, month: 7, day: 1 },
    ]);
  });

  it('skips other anniversaries, groups, unreadable dates and repeated ids', () => {
    const list = birthdaysFromContacts([
      card('w', { anniversaries: { x: { kind: 'wedding', date: '--06-01' } } }),
      card('g', { kind: 'group', ...birth('--06-01') }),
      card('bad', birth('--02-30')),
      card('ok', birth('--06-01')),
      card('ok', birth('--06-02')),
      null,
    ]);
    expect(list.map((b) => b.key)).toEqual(['ok']);
    expect(list[0].day).toBe(1);
  });

  it('uses the next readable birth date when the first is broken', () => {
    const list = birthdaysFromContacts([card('x', { anniversaries: { a: { kind: 'birth', date: 'junk' }, b: { kind: 'birth', date: '--03-04' } } })]);
    expect(list[0]).toMatchObject({ month: 3, day: 4 });
  });
});

describe('upcomingBirthdays', () => {
  const people = [
    { key: 'late', name: 'Late', year: null, month: 12, day: 24 },
    { key: 'today', name: 'Today', year: 1990, month: 10, day: 14 },
    { key: 'soon', name: 'Soon', year: null, month: 10, day: 20 },
    { key: 'past', name: 'Past', year: null, month: 10, day: 1 },
  ];

  it('lists birthdays within the window, soonest first, with the age', () => {
    const list = upcomingBirthdays(people, '2026-10-14', 30);
    expect(list.map((b) => [b.key, b.daysUntil, b.age])).toEqual([['today', 0, 36], ['soon', 6, null]]);
  });

  it('includes the last day of the window and wraps into next year', () => {
    expect(upcomingBirthdays(people, '2026-10-14', 6).map((b) => b.key)).toEqual(['today', 'soon']);
    expect(upcomingBirthdays(people, '2026-10-14', 5).map((b) => b.key)).toEqual(['today']);
    const all = upcomingBirthdays(people, '2026-10-14', 365);
    expect(all.at(-1)).toMatchObject({ key: 'past', date: '2027-10-01' });
  });
});
