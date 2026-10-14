// Live status from the tracking services, through the webmail's secret
// proxy (the API keys stay on the server, set by the admin):
// - 17TRACK API v2.2 (credential "track17"): every carrier. Numbers must be
//   registered once before 17TRACK reports on them.
// - DHL Shipment Tracking - Unified API (credential "dhl"): DHL numbers.
// DHL numbers go to DHL first when it is set up, everything else (and DHL
// numbers DHL doesn't know or can't be asked about) to 17TRACK.

import { from17track, fromDhl } from './status.js';

export const DEFAULT_CONFIG = {
  track17Url: 'https://api.17track.net/track/v2.2',
  dhlUrl: 'https://api-eu.dhl.com/track/shipments',
};

const CONFIG_TTL_MS = 5 * 60_000;
const UNAVAILABLE_MS = 10 * 60_000;
const TRACK17_BATCH = 40;
const MAX_EVENTS = 20;

/** A failure the UI can explain; `code` picks the message (errors.js). */
export class TrackingError extends Error {
  constructor(code, { retryAfter, detail } = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'TrackingError';
    this.code = code;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

function retryAfterOf(res) {
  const raw = res?.headers?.['retry-after'] ?? res?.headers?.['Retry-After'];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 60;
}

/** Turn a failed proxy answer into a TrackingError, or null when it is fine. */
export function errorFromResponse(res) {
  if (!res) return new TrackingError('service');
  if (res.proxyError) {
    switch (res.proxyError) {
      case 'no_credential': return new TrackingError('not_configured');
      case 'rate_limited': return new TrackingError('rate_limit', { retryAfter: retryAfterOf(res) });
      case 'timeout': return new TrackingError('timeout');
      case 'unreachable': return new TrackingError('unreachable');
      case 'blocked_address':
      case 'wrong_origin':
      case 'redirect_off_origin': return new TrackingError('blocked');
      default: return new TrackingError('service', { detail: res.proxyError });
    }
  }
  if (res.status === 401 || res.status === 403) return new TrackingError('auth');
  if (res.status === 429) return new TrackingError('rate_limit', { retryAfter: retryAfterOf(res) });
  if (res.status === 408 || res.status === 504) return new TrackingError('timeout');
  if (!res.ok) return new TrackingError('service', { detail: `HTTP ${res.status}` });
  return null;
}

function wrapThrown(err) {
  if (err instanceof TrackingError) return err;
  const msg = String(err?.message ?? err);
  if (/timed out/i.test(msg)) return new TrackingError('timeout');
  if (/network|fetch|reach/i.test(msg)) return new TrackingError('unreachable');
  return new TrackingError('service', { detail: msg.slice(0, 200) });
}

const str = (v) => (typeof v === 'string' ? v : '');

export function normalize17(item) {
  const info = item?.track_info;
  if (!info) return { status: 'pending', text: '', location: '', time: '', events: [], eta: null, provider: '17track' };
  const providers = info.tracking?.providers ?? [];
  const events = (providers[0]?.events ?? []).slice(0, MAX_EVENTS).map((e) => ({
    time: str(e.time_iso) || str(e.time_utc),
    text: str(e.description_translation?.description) || str(e.description),
    location: str(e.location),
    status: from17track(e.stage),
  }));
  const latest = info.latest_event;
  const eta = info.time_metrics?.estimated_delivery_date;
  return {
    status: from17track(info.latest_status?.status),
    text: str(latest?.description_translation?.description) || str(latest?.description),
    location: str(latest?.location),
    time: str(latest?.time_iso) || str(latest?.time_utc),
    events,
    eta: eta && (eta.from || eta.to) ? { from: str(eta.from), to: str(eta.to) } : null,
    carrierName: str(providers[0]?.provider?.name),
    provider: '17track',
  };
}

export function normalizeDhl(shipment) {
  const s = shipment?.status ?? {};
  const place = (e) => str(e?.location?.address?.addressLocality);
  const events = (shipment?.events ?? []).slice(0, MAX_EVENTS).map((e) => ({
    time: str(e.timestamp),
    text: str(e.description) || str(e.status),
    location: place(e),
    status: fromDhl(e.statusCode, `${str(e.status)} ${str(e.description)}`),
  }));
  const etaTo = str(shipment?.estimatedDeliveryTimeFrame?.estimatedThrough) || str(shipment?.estimatedTimeOfDelivery);
  const etaFrom = str(shipment?.estimatedDeliveryTimeFrame?.estimatedFrom);
  return {
    status: fromDhl(s.statusCode, `${str(s.status)} ${str(s.description)}`),
    text: str(s.description) || str(s.status),
    location: place(s),
    time: str(s.timestamp),
    events,
    eta: etaTo || etaFrom ? { from: etaFrom, to: etaTo } : null,
    carrierName: 'DHL',
    provider: 'dhl',
  };
}

const NOT_FOUND = (provider) => ({ status: 'not_found', text: '', location: '', time: '', events: [], eta: null, provider });

/**
 * A tracker bound to the plugin api. `trackMany(parcels)` resolves to a Map
 * number -> { result } | { error: TrackingError }.
 */
export function createTracker(api, { now = () => Date.now() } = {}) {
  let config = null;
  let configAt = 0;
  const unavailable = new Map(); // provider -> time until which we don't ask

  async function getConfig() {
    if (config && now() - configAt < CONFIG_TTL_MS) return config;
    let raw = {};
    try {
      raw = (await api.config.get()) || {};
    } catch {
      raw = {};
    }
    const url = (v, d) => (typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v.trim()) ? v.trim().replace(/\/+$/, '') : d);
    config = { track17Url: url(raw.track17Url, DEFAULT_CONFIG.track17Url), dhlUrl: url(raw.dhlUrl, DEFAULT_CONFIG.dhlUrl) };
    configAt = now();
    return config;
  }

  const isUnavailable = (provider) => (unavailable.get(provider) ?? 0) > now();
  const markUnavailable = (provider) => unavailable.set(provider, now() + UNAVAILABLE_MS);

  async function dhl(number) {
    const { dhlUrl } = await getConfig();
    const res = await api.proxy.fetch('dhl', `${dhlUrl}?trackingNumber=${encodeURIComponent(number)}`, {
      headers: { Accept: 'application/json' },
      responseType: 'json',
    });
    if (res && !res.proxyError && res.status === 404) return NOT_FOUND('dhl');
    const err = errorFromResponse(res);
    if (err) throw err;
    const shipment = res.body?.shipments?.[0];
    return shipment ? normalizeDhl(shipment) : NOT_FOUND('dhl');
  }

  async function post17(path, numbers) {
    const { track17Url } = await getConfig();
    const res = await api.proxy.fetch('track17', `${track17Url}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(numbers.map((number) => ({ number }))),
      responseType: 'json',
    });
    const err = errorFromResponse(res);
    if (err) throw err;
    const body = res.body ?? {};
    if (typeof body.code === 'number' && body.code !== 0) {
      const codes = (body.data?.errors ?? []).map((e) => e.code);
      if (body.code === 401 || codes.includes(-18010002) || codes.includes(-18010001)) throw new TrackingError('auth');
      if (codes.includes(-18010012) || codes.includes(-18010013) || codes.includes(-18010014)) throw new TrackingError('quota');
      if (body.code === 429) throw new TrackingError('rate_limit', { retryAfter: 60 });
      throw new TrackingError('service', { detail: `17TRACK code ${body.code}` });
    }
    return { accepted: body.data?.accepted ?? [], rejected: body.data?.rejected ?? [] };
  }

  /** 17TRACK for up to 40 numbers: register the ones it doesn't know yet, then read. */
  async function track17(numbers, out) {
    const first = await post17('gettrackinfo', numbers);
    for (const item of first.accepted) out.set(item.number, { result: normalize17(item) });
    const unregistered = [];
    for (const r of first.rejected) {
      if (r.error?.code === -18019902) unregistered.push(r.number);
      else if (r.error?.code === -18019903) out.set(r.number, { error: new TrackingError('unknown_number') });
      else out.set(r.number, { error: new TrackingError('service', { detail: String(r.error?.code ?? '') }) });
    }
    if (!unregistered.length) return;
    const reg = await post17('register', unregistered);
    const ready = new Set(reg.accepted.map((a) => a.number));
    for (const r of reg.rejected) {
      // Already registered (another device of this user, an earlier try): fine.
      if (r.error?.code === -18019901) ready.add(r.number);
      else if (r.error?.code === -18019903) out.set(r.number, { error: new TrackingError('unknown_number') });
      else out.set(r.number, { error: new TrackingError('service', { detail: String(r.error?.code ?? '') }) });
    }
    if (!ready.size) return;
    const second = await post17('gettrackinfo', [...ready]);
    for (const item of second.accepted) out.set(item.number, { result: normalize17(item) });
    for (const n of ready) if (!out.has(n)) out.set(n, { result: { ...NOT_FOUND('17track'), status: 'pending' } });
  }

  async function trackMany(parcels) {
    const out = await trackManyInner(parcels);
    // The user sees a plain message; the details go to the console for whoever debugs it.
    for (const [number, o] of out) {
      if (o.error && o.error.code !== 'not_configured') api.log?.warn?.(`parcels: ${number}: ${o.error.message}`);
    }
    return out;
  }

  async function trackManyInner(parcels) {
    const out = new Map();
    const via17 = [];
    const fallback = new Map(); // number -> DHL's "not found", used if 17TRACK can't help

    for (const p of parcels) {
      if (p.carrier === 'dhl' && !isUnavailable('dhl')) {
        try {
          const result = await dhl(p.number);
          if (result.status === 'not_found') {
            fallback.set(p.number, result);
            via17.push(p.number);
          } else {
            out.set(p.number, { result });
          }
        } catch (e) {
          const err = wrapThrown(e);
          if (err.code === 'not_configured') {
            markUnavailable('dhl');
            via17.push(p.number);
          } else {
            out.set(p.number, { error: err });
          }
        }
      } else {
        via17.push(p.number);
      }
    }

    for (let i = 0; i < via17.length; i += TRACK17_BATCH) {
      const batch = via17.slice(i, i + TRACK17_BATCH);
      if (isUnavailable('track17')) {
        for (const n of batch) out.set(n, fallback.has(n) ? { result: fallback.get(n) } : { error: new TrackingError('not_configured') });
        continue;
      }
      try {
        await track17(batch, out);
      } catch (e) {
        const err = wrapThrown(e);
        if (err.code === 'not_configured') markUnavailable('track17');
        for (const n of batch) {
          if (out.has(n)) continue;
          out.set(n, fallback.has(n) && err.code === 'not_configured' ? { result: fallback.get(n) } : { error: err });
        }
      }
    }
    return out;
  }

  // One request per number at a time: a second ask while the first runs
  // (React running an effect twice, two buttons) gets the same answer.
  const inFlight = new Map();

  return {
    trackMany,
    track(parcel) {
      const running = inFlight.get(parcel.number);
      if (running) return running;
      const promise = trackMany([parcel])
        .then((m) => m.get(parcel.number) ?? { error: new TrackingError('service') })
        .finally(() => inFlight.delete(parcel.number));
      inFlight.set(parcel.number, promise);
      return promise;
    },
    /** Forget the cached admin settings and "not set up" marks (e.g. after a settings change). */
    reset() { config = null; unavailable.clear(); },
  };
}
