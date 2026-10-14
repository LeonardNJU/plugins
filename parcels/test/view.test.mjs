import { describe, expect, it } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import manifest from '../manifest.json' with { type: 'json' };
import { errorText, eventLine, formatTime, notificationFor, shortNumber, statusLabel } from '../src/lib/view.js';

const api = fakeApi({ translations: manifest.locales });
const t = api.i18n.t;

describe('view text', () => {
  it('names statuses and errors, with a fallback for unknown codes', () => {
    expect(statusLabel(t, 'out_for_delivery')).toBe('Out for delivery');
    expect(statusLabel(t, 'something-new')).toBe('Waiting for the first update');
    expect(errorText(t, 'auth')).toMatch(/administrator/);
    expect(errorText(t, 'weird')).toBe('The tracking service had a problem. Try again later.');
  });

  it('keeps notifications inside the host limits', () => {
    const n = notificationFor(t, {
      number: 'JJD000390007878901234', carrierName: 'DHL', status: 'delivered',
      subject: 'x'.repeat(400), text: 'Delivered\nat the door',
    });
    expect(n.title).toBe('Parcel update: Delivered');
    expect(n.body.length).toBeLessThanOrEqual(300);
    expect(n.body).not.toMatch(/\n/);
    expect(n.body.startsWith('DHL JJD000390007878901234 · xxx')).toBe(true);
    expect(n.tag).toBe('parcel-JJD000390007878901234');
    expect(notificationFor(t, { number: 'A B/C', status: 'failed' }).tag).toBe('parcel-ABC');
  });

  it('formats numbers and times', () => {
    expect(shortNumber('00340434161094042557')).toBe('0034…2557');
    expect(shortNumber('1Z999AA1')).toBe('1Z999AA1');
    expect(formatTime('not a date', 'en')).toBe('');
    expect(formatTime('2026-10-12T07:55:00Z', 'de')).toMatch(/12\.10\.2026/);
    expect(eventLine({ text: 'Picked up', location: 'Bonn, DE', time: '' }, 'en')).toBe('Picked up · Bonn, DE');
  });
});
