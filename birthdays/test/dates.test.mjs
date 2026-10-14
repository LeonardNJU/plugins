import { describe, expect, it } from 'vitest';
import {
  addDays, ageIn, daysBetween, isLeapYear, localToday, nextOccurrence, occurrenceIn, parseBirthdayDate,
} from '../src/lib/dates.js';

describe('parseBirthdayDate', () => {
  it('reads dates without a year', () => {
    expect(parseBirthdayDate('--10-20')).toEqual({ year: null, month: 10, day: 20 });
    expect(parseBirthdayDate('--1020')).toEqual({ year: null, month: 10, day: 20 });
  });

  it('reads dates with a year, with or without dashes or a time', () => {
    expect(parseBirthdayDate('1990-05-03')).toEqual({ year: 1990, month: 5, day: 3 });
    expect(parseBirthdayDate('19900503')).toEqual({ year: 1990, month: 5, day: 3 });
    expect(parseBirthdayDate('1990-05-03T00:00:00Z')).toEqual({ year: 1990, month: 5, day: 3 });
  });

  it('reads JSContact PartialDate and Timestamp values', () => {
    expect(parseBirthdayDate({ '@type': 'PartialDate', month: 2, day: 29 })).toEqual({ year: null, month: 2, day: 29 });
    expect(parseBirthdayDate({ '@type': 'PartialDate', year: 1985, month: 12, day: 1 })).toEqual({ year: 1985, month: 12, day: 1 });
    expect(parseBirthdayDate({ '@type': 'Timestamp', utc: '1977-07-14T00:00:00Z' })).toEqual({ year: 1977, month: 7, day: 14 });
  });

  it('accepts February 29 without a year, and only in leap years with one', () => {
    expect(parseBirthdayDate('--02-29')).not.toBeNull();
    expect(parseBirthdayDate('2000-02-29')).not.toBeNull();
    expect(parseBirthdayDate('2001-02-29')).toBeNull();
  });

  it('refuses dates that do not exist and other calendars', () => {
    expect(parseBirthdayDate('--13-01')).toBeNull();
    expect(parseBirthdayDate('--04-31')).toBeNull();
    expect(parseBirthdayDate('next tuesday')).toBeNull();
    expect(parseBirthdayDate({ month: 3 })).toBeNull();
    expect(parseBirthdayDate({ month: 1, day: 1, calendarScale: 'hebrew' })).toBeNull();
    expect(parseBirthdayDate(null)).toBeNull();
  });
});

describe('occurrences', () => {
  const feb29 = { year: 2000, month: 2, day: 29 };

  it('knows leap years', () => {
    expect([1900, 2000, 2024, 2026].map(isLeapYear)).toEqual([false, true, true, false]);
  });

  it('celebrates February 29 on February 28 in years without it', () => {
    expect(occurrenceIn(feb29, 2027)).toBe('2027-02-28');
    expect(occurrenceIn(feb29, 2028)).toBe('2028-02-29');
  });

  it('finds the next birthday, today included', () => {
    const b = { year: null, month: 10, day: 14 };
    expect(nextOccurrence(b, '2026-10-14')).toEqual({ date: '2026-10-14', year: 2026 });
    expect(nextOccurrence(b, '2026-10-15')).toEqual({ date: '2027-10-14', year: 2027 });
    expect(nextOccurrence({ year: null, month: 1, day: 2 }, '2026-12-31')).toEqual({ date: '2027-01-02', year: 2027 });
  });

  it('moves a February 29 birthday to the 28th, and not to March', () => {
    expect(nextOccurrence(feb29, '2027-02-01').date).toBe('2027-02-28');
    expect(nextOccurrence(feb29, '2027-03-01').date).toBe('2028-02-29');
  });

  it('works out the age, or none without a birth year', () => {
    expect(ageIn({ year: 1990, month: 5, day: 3 }, 2026)).toBe(36);
    expect(ageIn({ year: null, month: 5, day: 3 }, 2026)).toBeNull();
    expect(ageIn({ year: 2026, month: 5, day: 3 }, 2026)).toBeNull();
  });

  it('counts days across months, years and leap days', () => {
    expect(daysBetween('2026-10-14', '2026-10-20')).toBe(6);
    expect(daysBetween('2027-12-31', '2028-03-01')).toBe(61);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('takes today from the local calendar', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
