import { describe, expect, it } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import {
  MAX_AGE_MS, MAX_PER_TICK, POLL_INTERVAL_MS, applyOutcome, getParcel, isDue, listParcels, newParcel, pollDue,
  rememberParcels, saveParcel, visibleParcels,
} from '../src/lib/parcels.js';

const T0 = Date.parse('2026-10-14T10:00:00Z');
const MIN = 60_000;
const dhl = (number = 'JJD000390007878901234') => ({ number, carrier: 'dhl', carrierName: 'DHL', trackingUrl: 'https://dhl.example/' + number });
const result = (status, text = '') => ({ result: { status, text, location: '', time: '', events: [], eta: null } });

/** A tracker that answers from a script: number -> list of outcomes, one per call. */
function scriptedTracker(script) {
  const asked = [];
  return {
    asked,
    async trackMany(parcels) {
      asked.push(parcels.map((p) => p.number));
      const out = new Map();
      for (const p of parcels) {
        const queue = script[p.number] ?? [];
        out.set(p.number, queue.length > 1 ? queue.shift() : queue[0]);
      }
      return out;
    },
  };
}

describe('when a parcel is polled', () => {
  const p = (extra) => ({ ...newParcel(dhl(), { now: T0 }), ...extra });

  it('at most every 30 minutes', () => {
    expect(isDue(p(), T0)).toBe(true);
    expect(isDue(p({ lastPolledAt: T0 }), T0 + POLL_INTERVAL_MS - 1)).toBe(false);
    expect(isDue(p({ lastPolledAt: T0 }), T0 + POLL_INTERVAL_MS)).toBe(true);
  });

  it('never once delivered, received, stopped or after 30 days', () => {
    expect(isDue(p({ status: 'delivered' }), T0 + 2 * POLL_INTERVAL_MS)).toBe(false);
    expect(isDue(p({ received: true }), T0)).toBe(false);
    expect(isDue(p({ stopped: true }), T0)).toBe(false);
    expect(isDue(p({ status: 'in_transit' }), T0 + MAX_AGE_MS - 1)).toBe(true);
    expect(isDue(p({ status: 'in_transit' }), T0 + MAX_AGE_MS)).toBe(false);
  });

  it('not before a service\'s retry-after', () => {
    const { parcel } = applyOutcome(p(), { error: { code: 'rate_limit', retryAfter: 7200 } }, T0);
    expect(parcel.error).toBe('rate_limit');
    expect(isDue(parcel, T0 + POLL_INTERVAL_MS)).toBe(false);
    expect(isDue(parcel, T0 + 7200_000)).toBe(true);
  });
});

describe('applyOutcome', () => {
  it('the first answer is not a change; a new status is', () => {
    const first = applyOutcome(newParcel(dhl(), { now: T0 }), result('info_received'), T0);
    expect(first.changed).toBe(false);
    expect(first.parcel).toMatchObject({ status: 'info_received', lastPolledAt: T0, lastChangeAt: T0 });
    const second = applyOutcome(first.parcel, result('in_transit', 'Picked up'), T0 + MIN);
    expect(second.changed).toBe(true);
    expect(second.parcel).toMatchObject({ status: 'in_transit', text: 'Picked up' });
    const same = applyOutcome(second.parcel, result('in_transit', 'Hub'), T0 + 2 * MIN);
    expect(same.changed).toBe(false);
    expect(same.parcel.lastChangeAt).toBe(T0 + MIN);
  });

  it('"no information" is not worth a notification', () => {
    const { parcel } = applyOutcome(newParcel(dhl(), { now: T0 }), result('in_transit'), T0);
    expect(applyOutcome(parcel, result('not_found'), T0 + MIN).changed).toBe(false);
  });

  it('an error keeps the last status', () => {
    const { parcel } = applyOutcome(newParcel(dhl(), { now: T0 }), result('in_transit'), T0);
    const failed = applyOutcome(parcel, { error: { code: 'timeout' } }, T0 + MIN);
    expect(failed).toMatchObject({ changed: false, parcel: { status: 'in_transit', error: 'timeout' } });
    expect(applyOutcome(failed.parcel, result('in_transit'), T0 + 2 * MIN).parcel.error).toBeNull();
  });
});

describe('storage', () => {
  it('remembers new parcels once and keeps "received"', async () => {
    const api = fakeApi();
    await rememberParcels(api.storage, [dhl()], { emailId: 'm1', subject: 'Shipped', now: T0 });
    const stored = await getParcel(api.storage, 'JJD000390007878901234');
    expect(stored).toMatchObject({ emailId: 'm1', subject: 'Shipped', addedAt: T0, received: false });
    await saveParcel(api.storage, { ...stored, received: true });
    await rememberParcels(api.storage, [dhl()], { emailId: 'm2', now: T0 + MIN });
    expect(await getParcel(api.storage, 'JJD000390007878901234')).toMatchObject({ emailId: 'm1', received: true });
    expect(Object.keys(api.storageSnapshot())).toEqual(['parcel:JJD000390007878901234']);
  });

  it('the widget lists unreceived parcels, latest activity first', async () => {
    const list = [
      { number: 'A', received: false, addedAt: 1, lastChangeAt: 5 },
      { number: 'B', received: true, addedAt: 9, lastChangeAt: 9 },
      { number: 'C', received: false, addedAt: 7, lastChangeAt: 0 },
    ];
    expect(visibleParcels(list).map((p) => p.number)).toEqual(['C', 'A']);
  });
});

describe('pollDue', () => {
  it('reports each status change once, as the mock number moves on', async () => {
    const api = fakeApi();
    await rememberParcels(api.storage, [dhl()], { now: T0 });
    const tracker = scriptedTracker({ JJD000390007878901234: [
      result('info_received'), result('in_transit'), result('out_for_delivery'), result('delivered'),
    ] });
    const changes = [];
    const onChange = (parcel, previous) => { changes.push(`${previous}->${parcel.status}`); };

    let now = T0;
    await pollDue(api.storage, tracker, { now, onChange });
    // Not due again within 30 minutes.
    await pollDue(api.storage, tracker, { now: now + 10 * MIN, onChange });
    expect(tracker.asked).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      now += POLL_INTERVAL_MS;
      await pollDue(api.storage, tracker, { now, onChange });
    }
    expect(changes).toEqual(['info_received->in_transit', 'in_transit->out_for_delivery', 'out_for_delivery->delivered']);
    // Delivered: no more requests.
    expect(tracker.asked).toHaveLength(4);
  });

  it('does not overwrite a parcel the user marked received meanwhile', async () => {
    const api = fakeApi();
    await rememberParcels(api.storage, [dhl()], { now: T0 });
    const tracker = {
      async trackMany(parcels) {
        const p = await getParcel(api.storage, parcels[0].number);
        await saveParcel(api.storage, { ...p, received: true });
        return new Map([[parcels[0].number, result('delivered')]]);
      },
    };
    const res = await pollDue(api.storage, tracker, { now: T0 });
    expect(res.changed).toBe(0);
    expect(await getParcel(api.storage, 'JJD000390007878901234')).toMatchObject({ received: true, status: null });
  });

  it(`asks about at most ${MAX_PER_TICK} parcels per round, the longest-waiting first`, async () => {
    const api = fakeApi();
    for (let i = 0; i < MAX_PER_TICK + 5; i++) {
      await saveParcel(api.storage, { ...newParcel(dhl(`TBA${String(i).padStart(12, '0')}`), { now: T0 }), lastPolledAt: i === 24 ? 1 : T0 - POLL_INTERVAL_MS });
    }
    const tracker = scriptedTracker({});
    await pollDue(api.storage, tracker, { now: T0 });
    expect(tracker.asked[0]).toHaveLength(MAX_PER_TICK);
    expect(tracker.asked[0][0]).toBe('TBA000000000024');
  });

  it('two pollers at the same moment (two tabs) ask about a parcel once', async () => {
    const api = fakeApi();
    await rememberParcels(api.storage, [dhl()], { now: T0 });
    const tracker = scriptedTracker({ JJD000390007878901234: [result('info_received')] });
    await Promise.all([
      pollDue(api.storage, tracker, { now: T0, claimDelayMs: 5 }),
      pollDue(api.storage, tracker, { now: T0, claimDelayMs: 5 }),
    ]);
    expect(tracker.asked.flat()).toEqual(['JJD000390007878901234']);
    const stored = await getParcel(api.storage, 'JJD000390007878901234');
    expect(stored.status).toBe('info_received');
    expect(stored.pollClaim).toBeUndefined();
  });

  it('stops parcels after 30 days and reports retry-after', async () => {
    const api = fakeApi();
    await rememberParcels(api.storage, [dhl('OLD0000000001'), dhl('NEW0000000001')], { now: T0 });
    await saveParcel(api.storage, { ...(await getParcel(api.storage, 'OLD0000000001')), addedAt: T0 - MAX_AGE_MS });
    const tracker = scriptedTracker({ NEW0000000001: [{ error: { code: 'rate_limit', retryAfter: 120 } }] });
    const res = await pollDue(api.storage, tracker, { now: T0 });
    expect(res).toMatchObject({ polled: 1, retryAfter: 120 });
    const all = await listParcels(api.storage);
    expect(all.find((p) => p.number === 'OLD0000000001').stopped).toBe(true);
  });
});
