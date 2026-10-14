import { describe, expect, it } from 'vitest';
import { findDueDate, findDueDateIn, ownText } from '../src/lib/due-date.js';

// Wednesday, 14 October 2026, local time.
const WED = new Date(2026, 9, 14, 10, 30);
const due = (text, ref = WED) => findDueDateIn(text, ref)?.date ?? null;

describe('findDueDateIn: English', () => {
  it.each([
    ['Please send it until 2026-10-20.', '2026-10-20'],
    ['Can you do this by Friday?', '2026-10-16'],
    ['by friday please', '2026-10-16'],
    ['due next Friday', '2026-10-16'],
    ['Needed by Wednesday', '2026-10-14'],
    ['Needed by next Wednesday', '2026-10-21'],
    ['by tomorrow', '2026-10-15'],
    ['by the day after tomorrow', '2026-10-16'],
    ['by today', '2026-10-14'],
    ['by EOD', '2026-10-14'],
    ['Deadline: 20 October 2026', '2026-10-20'],
    ['due by October 30', '2026-10-30'],
    ['no later than Oct 2nd, 2027', '2027-10-02'],
    ['by the 3rd of November', '2026-11-03'],
    ['by the end of the week', '2026-10-16'],
    ['by end of month', '2026-10-31'],
    ['by the end of November', '2026-11-30'],
    ['before next week', '2026-10-19'],
    ['within 3 days', '2026-10-17'],
    ['within two weeks', '2026-10-28'],
    ['by in 2 days', '2026-10-16'],
    ['by 10/20/2026', '2026-10-20'],
    ['until 20/10', '2026-10-20'],
  ])('%s', (text, expected) => {
    expect(due(text)).toBe(expected);
  });

  it('rolls a day and month without a year into next year when it has passed', () => {
    expect(due('by 3 March')).toBe('2027-03-03');
    expect(due('until 01.02.')).toBe('2027-02-01');
  });

  it('ignores dates without a deadline word and deadline words without a date', () => {
    expect(due('We met on 20 October 2026 and it was nice.')).toBeNull();
    expect(due('Sent by John, due to the weather')).toBeNull();
    expect(due('Meeting: 2026-10-20 10:00')).toBeNull();
  });

  it('refuses dates that do not exist', () => {
    expect(due('until 2026-02-30')).toBeNull();
    expect(due('by 31.04.2026')).toBeNull();
  });

  it('leaves slash dates that read both ways alone', () => {
    expect(due('by 03/04/2026')).toBeNull();
  });

  it('returns the words it used', () => {
    expect(findDueDateIn('Hi, can you send it by Friday? Thanks', WED)).toEqual({ date: '2026-10-16', match: 'by Friday' });
  });
});

describe('findDueDateIn: German', () => {
  it.each([
    ['Bitte bis zum 20.10.2026 erledigen', '2026-10-20'],
    ['bis 20.10.26', '2026-10-20'],
    ['bis zum 20.10.', '2026-10-20'],
    ['spätestens Freitag', '2026-10-16'],
    ['bis spätestens nächsten Freitag', '2026-10-16'],
    ['bis Freitag', '2026-10-16'],
    ['bis morgen', '2026-10-15'],
    ['bis übermorgen', '2026-10-16'],
    ['fällig am 3. November', '2026-11-03'],
    ['Frist: 30. Okt. 2026', '2026-10-30'],
    ['bis Ende der Woche', '2026-10-16'],
    ['bis Monatsende', '2026-10-31'],
    ['bis Ende Dezember', '2026-12-31'],
    ['bis nächste Woche', '2026-10-19'],
    ['bitte innerhalb von 5 Tagen', '2026-10-19'],
    ['Antwort binnen 3 Tagen', '2026-10-17'],
    ['bis in einer Woche', '2026-10-21'],
    ['bis Mitte März', null],
    ['Bis bald!', null],
  ])('%s', (text, expected) => {
    expect(due(text)).toBe(expected);
  });
});

describe('ownText and findDueDate', () => {
  it('drops quoted lines and everything after a reply header', () => {
    const text = 'Thanks!\n> by Monday\nOn Tue, 13 Oct 2026, Bob wrote:\nplease answer until 2026-12-01';
    expect(ownText(text)).toBe('Thanks!');
  });

  it('counts from when the message arrived, not from today', () => {
    // Received on Monday 5 October 2026: "by Friday" is 9 October.
    expect(findDueDate({ subject: 'Report', text: 'Please send it by Friday.', receivedAt: '2026-10-05T09:00:00' }).date).toBe('2026-10-09');
  });

  it('prefers the subject over the text', () => {
    const found = findDueDate({ subject: 'Invoice due 2026-11-01', text: 'pay by Friday', receivedAt: '2026-10-14T09:00:00' });
    expect(found).toEqual({ date: '2026-11-01', match: 'due 2026-11-01' });
  });

  it('does not take a deadline from a quoted older message', () => {
    expect(findDueDate({ subject: 'Re: report', text: 'Done, see attached.\n\n> Please send it by Friday', receivedAt: '2026-10-14T09:00:00' })).toBeNull();
  });
});
