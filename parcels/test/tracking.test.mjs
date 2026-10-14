import { describe, expect, it } from 'vitest';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { createTracker, errorFromResponse, normalize17, normalizeDhl } from '../src/lib/tracking.js';
import { fromDhl } from '../src/lib/status.js';

const BASE17 = 'http://localhost:18099/17track/track/v2.2';
const BASEDHL = 'http://localhost:18099/dhl/track/shipments';

// The shapes the 17TRACK v2.2 and DHL Unified APIs answer with (trimmed).
const info17 = (number, status, description = 'The shipment has been picked up') => ({
  number, carrier: 7041,
  track_info: {
    latest_status: { status },
    latest_event: { time_iso: '2026-10-10T18:40:00+02:00', description, location: 'Bonn, DE', stage: status },
    time_metrics: { estimated_delivery_date: { from: '2026-10-12T00:00:00+02:00', to: '2026-10-13T00:00:00+02:00' } },
    tracking: { providers: [{ provider: { name: 'DHL Paket' }, events: [
      { time_iso: '2026-10-10T18:40:00+02:00', description, location: 'Bonn, DE', stage: status },
      { time_iso: '2026-10-10T09:12:00+02:00', description: 'Data received', location: 'Bonn, DE', stage: 'InfoReceived' },
    ] }] },
  },
});

const dhlShipment = (number, statusCode, description = 'The shipment has been processed in the parcel center') => ({
  id: number,
  status: { timestamp: '2026-10-11T03:05:00', statusCode, status: 'InTransit', description, location: { address: { addressLocality: 'Hannover, DE' } } },
  events: [{ timestamp: '2026-10-11T03:05:00', statusCode, status: 'InTransit', description, location: { address: { addressLocality: 'Hannover, DE' } } }],
});

/** A fake 17TRACK + DHL behind api.proxy.fetch, recording what was asked. */
function services({ dhl = 'ok', track17 = 'ok', registered = [], statuses = {}, missOnce = [] } = {}) {
  const seen = { register: [], info: [], dhl: [] };
  const reg = new Set(registered);
  const miss = new Set(missOnce);
  const handler = async (credentialId, url, init = {}) => {
    if (credentialId === 'dhl') {
      if (dhl === 'missing') return { status: 404, ok: false, headers: { 'x-bulwark-proxy-error': 'no_credential' }, body: 'No such credential', proxyError: 'no_credential' };
      const number = new URL(url).searchParams.get('trackingNumber');
      seen.dhl.push(number);
      expect(url.startsWith(BASEDHL)).toBe(true);
      if (dhl === 'unauthorized') return proxyResponse({ title: 'Unauthorized' }, { status: 401 });
      if (!statuses[number]) return proxyResponse({ title: 'No result found' }, { status: 404 });
      return proxyResponse({ shipments: [dhlShipment(number, statuses[number].dhl ?? 'transit')] });
    }
    expect(credentialId).toBe('track17');
    if (track17 === 'missing') return { status: 404, ok: false, headers: {}, body: '', proxyError: 'no_credential' };
    if (track17 === 'unauthorized') return proxyResponse({ code: 401, data: { errors: [{ code: -18010002 }] } }, { status: 401 });
    if (track17 === 'busy') return proxyResponse({}, { status: 429, headers: { 'retry-after': '7' } });
    if (track17 === 'timeout') return { status: 504, ok: false, headers: {}, body: '', proxyError: 'timeout' };
    expect(init.method).toBe('POST');
    const numbers = JSON.parse(init.body).map((x) => x.number);
    const accepted = [];
    const rejected = [];
    if (url === `${BASE17}/register`) {
      seen.register.push(...numbers);
      for (const n of numbers) {
        if (!statuses[n]) rejected.push({ number: n, error: { code: -18019903 } });
        else if (reg.has(n)) rejected.push({ number: n, error: { code: -18019901 } });
        else { reg.add(n); accepted.push({ number: n, carrier: 7041 }); }
      }
    } else if (url === `${BASE17}/gettrackinfo`) {
      seen.info.push(...numbers);
      for (const n of numbers) {
        if (miss.delete(n)) { reg.add(n); rejected.push({ number: n, error: { code: -18019902 } }); }
        else if (!reg.has(n)) rejected.push({ number: n, error: { code: -18019902 } });
        else accepted.push(info17(n, statuses[n].s17 ?? 'InTransit'));
      }
    } else {
      throw new Error(`unexpected url ${url}`);
    }
    return proxyResponse({ code: 0, data: { accepted, rejected } });
  };
  const api = fakeApi({
    id: 'parcels',
    handlers: {
      'proxy.fetch': handler,
      'config.get': async () => ({ track17Url: `${BASE17}/`, dhlUrl: BASEDHL }),
    },
  });
  return { api, seen };
}

describe('17TRACK', () => {
  it('registers unknown numbers once, then reads their status', async () => {
    const { api, seen } = services({ dhl: 'missing', statuses: { '1Z999AA10123456784': { s17: 'Delivered' } } });
    const tracker = createTracker(api);
    const out = await tracker.track({ number: '1Z999AA10123456784', carrier: 'ups' });
    expect(out.result).toMatchObject({ status: 'delivered', provider: '17track', location: 'Bonn, DE', carrierName: 'DHL Paket' });
    expect(out.result.events).toHaveLength(2);
    expect(seen.register).toEqual(['1Z999AA10123456784']);
    expect(seen.info).toEqual(['1Z999AA10123456784', '1Z999AA10123456784']);
    // Known now: no second registration.
    await tracker.track({ number: '1Z999AA10123456784', carrier: 'ups' });
    expect(seen.register).toHaveLength(1);
  });

  it('treats "already registered" as registered', async () => {
    // Registered elsewhere between our two calls: register answers -18019901.
    const { api, seen } = services({ statuses: { TBA123456789012: { s17: 'OutForDelivery' } }, missOnce: ['TBA123456789012'] });
    const out = await createTracker(api).track({ number: 'TBA123456789012', carrier: 'amazon' });
    expect(seen.register).toEqual(['TBA123456789012']);
    expect(out.result?.status).toBe('out_for_delivery');
  });

  it('asks once when the same parcel is looked up twice at the same time', async () => {
    const { api, seen } = services({ dhl: 'missing', statuses: { TBA123456789012: { s17: 'InTransit' } }, registered: ['TBA123456789012'] });
    const tracker = createTracker(api);
    const [a, b] = await Promise.all([tracker.track({ number: 'TBA123456789012' }), tracker.track({ number: 'TBA123456789012' })]);
    expect(a.result.status).toBe('in_transit');
    expect(b).toBe(a);
    expect(seen.info).toEqual(['TBA123456789012']);
    await tracker.track({ number: 'TBA123456789012' });
    expect(seen.info).toHaveLength(2);
  });

  it('reports a number 17TRACK cannot place', async () => {
    const { api } = services({ statuses: {} });
    const out = await createTracker(api).track({ number: 'TBA000000000000', carrier: 'amazon' });
    expect(out.error.code).toBe('unknown_number');
  });

  it('batches 40 numbers per request', async () => {
    const statuses = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`TBA${String(i).padStart(12, '0')}`, { s17: 'InTransit' }]));
    const { api } = services({ statuses, registered: Object.keys(statuses) });
    const out = await createTracker(api).trackMany(Object.keys(statuses).map((number) => ({ number, carrier: 'amazon' })));
    expect(out.size).toBe(45);
    const infoCalls = api.calls('proxy.fetch').filter((c) => c.args[1].endsWith('/gettrackinfo'));
    expect(infoCalls.map((c) => JSON.parse(c.args[2].body).length)).toEqual([40, 5]);
  });

  it('maps HTTP and proxy failures to plain error codes', async () => {
    for (const [track17, code] of [['unauthorized', 'auth'], ['busy', 'rate_limit'], ['timeout', 'timeout'], ['missing', 'not_configured']]) {
      const { api } = services({ track17, statuses: { TBA123456789012: {} } });
      const out = await createTracker(api).track({ number: 'TBA123456789012', carrier: 'amazon' });
      expect(out.error?.code, track17).toBe(code);
      if (code === 'rate_limit') expect(out.error.retryAfter).toBe(7);
    }
  });

  it('normalizes a track_info', () => {
    expect(normalize17(info17('X', 'AvailableForPickup'))).toMatchObject({
      status: 'available_for_pickup', text: 'The shipment has been picked up', time: '2026-10-10T18:40:00+02:00',
      eta: { from: '2026-10-12T00:00:00+02:00', to: '2026-10-13T00:00:00+02:00' },
    });
    expect(normalize17({ number: 'X', track_info: null }).status).toBe('pending');
  });
});

describe('DHL', () => {
  it('asks DHL first for DHL numbers', async () => {
    const { api, seen } = services({ statuses: { '00340434161094042557': { dhl: 'transit', s17: 'Delivered' } }, registered: ['00340434161094042557'] });
    const out = await createTracker(api).track({ number: '00340434161094042557', carrier: 'dhl' });
    expect(out.result).toMatchObject({ status: 'in_transit', provider: 'dhl', location: 'Hannover, DE' });
    expect(seen.dhl).toEqual(['00340434161094042557']);
    expect(seen.info).toEqual([]);
  });

  it('falls back to 17TRACK when the admin set up no DHL key, and stops asking DHL', async () => {
    const { api, seen } = services({ dhl: 'missing', statuses: { JJD000390007878901234: { s17: 'InfoReceived' } } });
    const tracker = createTracker(api);
    const out = await tracker.track({ number: 'JJD000390007878901234', carrier: 'dhl' });
    expect(out.result).toMatchObject({ status: 'info_received', provider: '17track' });
    await tracker.track({ number: 'JJD000390007878901234', carrier: 'dhl' });
    const dhlCalls = api.calls('proxy.fetch').filter((c) => c.args[0] === 'dhl');
    expect(dhlCalls).toHaveLength(1);
    expect(seen.info.length).toBeGreaterThan(0);
  });

  it('tries 17TRACK when DHL does not know the number, and keeps DHL\'s answer if 17TRACK is not set up', async () => {
    const { api } = services({ track17: 'missing', statuses: {} });
    const out = await createTracker(api).track({ number: '00340434161094042557', carrier: 'dhl' });
    expect(out.result).toMatchObject({ status: 'not_found', provider: 'dhl' });
  });

  it('reports a rejected DHL key', async () => {
    const { api } = services({ dhl: 'unauthorized', statuses: { '00340434161094042557': {} } });
    const out = await createTracker(api).track({ number: '00340434161094042557', carrier: 'dhl' });
    expect(out.error.code).toBe('auth');
  });

  it('reads "out for delivery" from the event text', () => {
    expect(fromDhl('transit', 'The shipment has been loaded onto the delivery vehicle')).toBe('out_for_delivery');
    expect(fromDhl('transit', 'OutForDelivery')).toBe('out_for_delivery');
    expect(fromDhl('transit', 'Processed in the parcel center')).toBe('in_transit');
    expect(fromDhl('failure')).toBe('failed');
    expect(normalizeDhl(dhlShipment('X', 'delivered', 'Delivered')).status).toBe('delivered');
  });
});

describe('configuration', () => {
  it('uses the public API addresses when the admin config cannot be read', async () => {
    const calls = [];
    const api = fakeApi({ handlers: {
      'config.get': async () => { throw new Error('no permission'); },
      'proxy.fetch': async (id, url) => { calls.push(url); return proxyResponse({ code: 0, data: { accepted: [], rejected: [] } }); },
    } });
    await createTracker(api).track({ number: 'TBA123456789012', carrier: 'amazon' });
    expect(calls[0]).toBe('https://api.17track.net/track/v2.2/gettrackinfo');
  });

  it('never accepts a non-http address from the config', async () => {
    const calls = [];
    const api = fakeApi({ handlers: {
      'config.get': async () => ({ track17Url: 'javascript:alert(1)' }),
      'proxy.fetch': async (id, url) => { calls.push(url); return proxyResponse({ code: 0, data: { accepted: [], rejected: [] } }); },
    } });
    await createTracker(api).track({ number: 'TBA123456789012', carrier: 'amazon' });
    expect(calls[0].startsWith('https://api.17track.net/')).toBe(true);
  });

  it('errorFromResponse covers the proxy\'s own refusals', () => {
    expect(errorFromResponse({ proxyError: 'rate_limited', headers: { 'retry-after': '30' } })).toMatchObject({ code: 'rate_limit', retryAfter: 30 });
    expect(errorFromResponse({ proxyError: 'blocked_address', headers: {} }).code).toBe('blocked');
    expect(errorFromResponse({ proxyError: 'unreachable', headers: {} }).code).toBe('unreachable');
    expect(errorFromResponse({ status: 200, ok: true, headers: {} })).toBeNull();
  });
});
