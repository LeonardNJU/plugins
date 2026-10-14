import { describe, expect, it } from 'vitest';
import {
  dayShift, formatMultiZone, formatTime, formatOffset, isOutsideHours, isValidZone, localDate, offsetMinutes,
  parseZoneList, resolveZone, wallClock, zoneCity, zonedToInstant,
} from '../src/lib/zones.js';

const at = (iso) => Date.parse(iso);

describe('offsets', () => {
  it('reads summer and winter offsets', () => {
    expect(offsetMinutes('Europe/Berlin', at('2026-07-01T12:00:00Z'))).toBe(120);
    expect(offsetMinutes('Europe/Berlin', at('2026-01-15T12:00:00Z'))).toBe(60);
    expect(offsetMinutes('America/New_York', at('2026-01-15T12:00:00Z'))).toBe(-300);
    expect(offsetMinutes('Asia/Kolkata', at('2026-01-15T12:00:00Z'))).toBe(330);
    expect(offsetMinutes('UTC', at('2026-01-15T12:00:00Z'))).toBe(0);
  });

  it('switches exactly at the DST change', () => {
    // Berlin goes to summer time on 2026-03-29 at 01:00 UTC.
    expect(offsetMinutes('Europe/Berlin', at('2026-03-29T00:59:00Z'))).toBe(60);
    expect(offsetMinutes('Europe/Berlin', at('2026-03-29T01:00:00Z'))).toBe(120);
  });

  it('writes offsets with a real minus and minutes when needed', () => {
    expect(formatOffset(0)).toBe('UTC');
    expect(formatOffset(120)).toBe('UTC+2');
    expect(formatOffset(-300)).toBe('UTC−5');
    expect(formatOffset(330)).toBe('UTC+5:30');
    expect(formatOffset(-570)).toBe('UTC−9:30');
  });
});

describe('zonedToInstant', () => {
  it('turns a wall clock into the right instant', () => {
    expect(zonedToInstant('2026-10-14T15:00', 'Europe/Berlin')).toBe(at('2026-10-14T13:00:00Z'));
    expect(zonedToInstant('2026-01-14T15:00', 'Europe/Berlin')).toBe(at('2026-01-14T14:00:00Z'));
    expect(zonedToInstant('2026-01-14T09:00', 'America/New_York')).toBe(at('2026-01-14T14:00:00Z'));
  });

  it('moves a time in the spring gap forward by the gap', () => {
    // 02:30 does not exist in Berlin on 2026-03-29; it reads as 03:30 CEST.
    const t = zonedToInstant('2026-03-29T02:30', 'Europe/Berlin');
    expect(t).toBe(at('2026-03-29T01:30:00Z'));
    expect(wallClock(t, 'Europe/Berlin')).toMatchObject({ hour: 3, minute: 30 });
  });

  it('takes the earlier of a time that happens twice in autumn', () => {
    // 02:30 happens twice in Berlin on 2026-10-25: first at +2, then at +1.
    expect(zonedToInstant('2026-10-25T02:30', 'Europe/Berlin')).toBe(at('2026-10-25T00:30:00Z'));
  });

  it('handles the US change on another date than Europe', () => {
    // New York changes on 2026-03-08; 02:30 is in the gap.
    expect(wallClock(zonedToInstant('2026-03-08T02:30', 'America/New_York'), 'America/New_York')).toMatchObject({ hour: 3, minute: 30 });
    expect(zonedToInstant('2026-03-08T12:00', 'America/New_York')).toBe(at('2026-03-08T16:00:00Z'));
  });

  it('refuses unreadable input', () => {
    expect(zonedToInstant('tomorrow', 'Europe/Berlin')).toBeNaN();
    expect(zonedToInstant('2026-13-01T10:00', 'Europe/Berlin')).toBeNaN();
  });
});

describe('working hours', () => {
  const ny = 'America/New_York';
  it('is fine inside 08:00-20:00', () => {
    expect(isOutsideHours(at('2026-10-14T13:00:00Z'), at('2026-10-14T14:00:00Z'), ny)).toBe(false); // 09:00-10:00
  });
  it('warns for an early start', () => {
    expect(isOutsideHours(at('2026-10-14T11:30:00Z'), at('2026-10-14T12:30:00Z'), ny)).toBe(true); // 07:30
  });
  it('allows an end at exactly 20:00 but not later', () => {
    expect(isOutsideHours(at('2026-10-14T23:00:00Z'), at('2026-10-15T00:00:00Z'), ny)).toBe(false); // 19:00-20:00
    expect(isOutsideHours(at('2026-10-14T23:00:00Z'), at('2026-10-15T00:01:00Z'), ny)).toBe(true);
  });
  it('allows a start at exactly 08:00', () => {
    expect(isOutsideHours(at('2026-10-14T12:00:00Z'), at('2026-10-14T13:00:00Z'), ny)).toBe(false);
  });
  it('warns when it runs over midnight', () => {
    expect(isOutsideHours(at('2026-10-14T12:00:00Z'), at('2026-10-15T12:00:00Z'), ny, 0, 24)).toBe(true);
  });
  it('uses the hours it is given', () => {
    expect(isOutsideHours(at('2026-10-14T13:00:00Z'), at('2026-10-14T14:00:00Z'), ny, 10, 18)).toBe(true);
  });
});

describe('dates', () => {
  it('knows the local date and the day difference', () => {
    const t = at('2026-10-14T22:30:00Z');
    expect(localDate(t, 'Asia/Tokyo')).toBe('2026-10-15');
    expect(dayShift(t, 'Asia/Tokyo', 'Europe/London')).toBe(1);
    expect(dayShift(at('2026-10-15T02:00:00Z'), 'America/Los_Angeles', 'Europe/Berlin')).toBe(-1);
    expect(dayShift(t, 'Europe/Berlin', 'Europe/Paris')).toBe(0);
  });
});

describe('names', () => {
  it('turns zone ids into city names', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zoneCity('Etc/UTC')).toBe('UTC');
  });

  it('resolves what users type', () => {
    expect(resolveZone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveZone('europe/berlin')).toBe('Europe/Berlin');
    expect(resolveZone('New York')).toBe('America/New_York');
    expect(resolveZone('new_york')).toBe('America/New_York');
    expect(resolveZone('Munich')).toBe('Europe/Berlin');
    expect(resolveZone('São Paulo')).toBe('America/Sao_Paulo');
    expect(resolveZone('utc')).toBe('UTC');
    expect(resolveZone('Atlantis')).toBeNull();
    expect(resolveZone('')).toBeNull();
  });

  it('splits a list, drops duplicates and reports unknown entries', () => {
    expect(parseZoneList('Berlin, New York; Asia/Tokyo\nberlin, Atlantis')).toEqual({
      zones: ['Europe/Berlin', 'America/New_York', 'Asia/Tokyo'],
      unknown: ['Atlantis'],
    });
    expect(parseZoneList('')).toEqual({ zones: [], unknown: [] });
  });

  it('checks zone ids', () => {
    expect(isValidZone('Asia/Tokyo')).toBe(true);
    expect(isValidZone('Mars/Olympus')).toBe(false);
    expect(isValidZone('')).toBe(false);
  });
});

describe('formatTime', () => {
  it('follows the clock of the locale', () => {
    const t = at('2026-10-14T13:05:00Z');
    expect(formatTime(t, 'America/New_York', 'de')).toBe('09:05');
    expect(formatTime(t, 'America/New_York', 'en-US')).toMatch(/^9:05\sAM$/);
    expect(formatTime(t, 'Europe/Berlin', 'not a locale!')).toMatch(/3:05/);
  });
});

describe('formatMultiZone', () => {
  it('writes one line with each zone', () => {
    const t = at('2026-10-14T13:00:00Z');
    expect(formatMultiZone(t, ['Europe/Berlin', 'America/New_York'], 'de')).toBe('15:00 Berlin / 09:00 New York');
  });

  it('adds weekdays when the zones are on different dates', () => {
    const t = at('2026-10-14T21:00:00Z');
    expect(formatMultiZone(t, ['Europe/Berlin', 'Asia/Tokyo'], 'en-GB')).toBe('Wed 23:00 Berlin / Thu 06:00 Tokyo');
  });

  it('skips unknown zones', () => {
    expect(formatMultiZone(at('2026-10-14T13:00:00Z'), ['Nowhere/City', 'UTC'], 'de')).toBe('13:00 UTC');
    expect(formatMultiZone(0, [], 'de')).toBe('');
  });
});
