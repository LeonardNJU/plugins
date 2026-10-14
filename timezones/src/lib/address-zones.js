// Time zones the user set for individual people, by email address. Kept in
// the plugin's storage (per mail account, on this device).

import { isValidZone } from './zones.js';

export const STORAGE_KEY = 'addressZones';
export const MAX_ENTRIES = 500;

export function normaliseAddress(address) {
  const a = String(address ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(a) ? a : null;
}

function clean(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [address, zone] of Object.entries(map)) {
    const a = normaliseAddress(address);
    if (a && isValidZone(zone)) out[a] = zone;
  }
  return out;
}

export async function loadAddressZones(storage) {
  try {
    return clean(await storage.get(STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Set (or with `zone` null, forget) the zone of one address. Returns the new map. */
export async function setAddressZone(storage, address, zone) {
  const a = normaliseAddress(address);
  if (!a) throw new Error('invalid-address');
  if (zone !== null && !isValidZone(zone)) throw new Error('invalid-zone');
  const map = await loadAddressZones(storage);
  if (zone === null) delete map[a];
  else {
    delete map[a];
    map[a] = zone;
    const keys = Object.keys(map);
    // Oldest entries go first when the list is full.
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete map[k];
  }
  await storage.set(STORAGE_KEY, map);
  return map;
}

export function zoneFor(map, address) {
  const a = normaliseAddress(address);
  return a && map ? map[a] ?? null : null;
}
