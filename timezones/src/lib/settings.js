// The user's settings, read once into plain values with defaults filled in.

import { browserZone, parseZoneList, resolveZone } from './zones.js';

export const DEFAULTS = {
  favouriteZones: '',
  homeZone: '',
  workStart: 8,
  workEnd: 20,
  worldClock: false,
};

function hour(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(24, Math.max(0, Math.round(n)));
}

/**
 * `{ home, favourites, unknown, homeUnknown, workStart, workEnd, worldClock }`.
 * `home` is the zone the user set, or the browser's when none (or an unknown
 * one) is set. `favourites` never contains `home`.
 */
export function readSettings(raw = {}) {
  const s = { ...DEFAULTS, ...(raw || {}) };
  const homeEntry = String(s.homeZone ?? '').trim();
  const homeResolved = homeEntry ? resolveZone(homeEntry) : null;
  const home = homeResolved || browserZone();
  const { zones, unknown } = parseZoneList(s.favouriteZones);
  let workStart = hour(s.workStart, DEFAULTS.workStart);
  let workEnd = hour(s.workEnd, DEFAULTS.workEnd);
  if (workEnd <= workStart) {
    workStart = DEFAULTS.workStart;
    workEnd = DEFAULTS.workEnd;
  }
  return {
    home,
    homeUnknown: homeEntry && !homeResolved ? homeEntry : null,
    favourites: zones.filter((z) => z !== home),
    unknown,
    workStart,
    workEnd,
    worldClock: s.worldClock === true || s.worldClock === 'true',
  };
}

// A slot iframe opened after the user changed a setting is started with the
// settings from when the plugin was loaded (the host keeps that copy), and
// only hears about changes made while it is open. The background instance
// hears every change, so it keeps a copy in storage for slots to start from.
export const SETTINGS_MIRROR_KEY = 'settingsMirror';

/** In the background: keep the stored copy current. Returns a stop function. */
export function mirrorSettings(api) {
  const save = (settings) => {
    Promise.resolve(api.storage.set(SETTINGS_MIRROR_KEY, { ...(settings ?? api.plugin.settings) })).catch(() => {});
  };
  save(api.plugin.settings);
  return api.plugin.onSettingsChange((next) => save(next));
}

/** In a slot: the stored copy, or null. */
export async function readMirroredSettings(api) {
  try {
    const value = await api.storage.get(SETTINGS_MIRROR_KEY);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
