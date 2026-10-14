import { afterEach, describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { readSettings, readMirroredSettings, SETTINGS_MIRROR_KEY } from '../src/lib/settings.js';
import { loadAddressZones, setAddressZone, zoneFor, MAX_ENTRIES } from '../src/lib/address-zones.js';
import { browserZone } from '../src/lib/zones.js';
import { setApi } from '../src/host.js';
import { SettingsSection } from '../src/ui/settings-section.jsx';
import plugin from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };

describe('readSettings', () => {
  it('fills in defaults and uses the browser zone without a home zone', () => {
    const s = readSettings({});
    expect(s.home).toBe(browserZone());
    expect(s.favourites).toEqual([]);
    expect(s.workStart).toBe(8);
    expect(s.workEnd).toBe(20);
    expect(s.worldClock).toBe(false);
  });

  it('resolves the home zone and favourites and leaves home out of the favourites', () => {
    const s = readSettings({ homeZone: 'Berlin', favouriteZones: 'Berlin, New York, Atlantis' });
    expect(s.home).toBe('Europe/Berlin');
    expect(s.favourites).toEqual(['America/New_York']);
    expect(s.unknown).toEqual(['Atlantis']);
  });

  it('falls back to the browser zone for an unknown home zone and says so', () => {
    const s = readSettings({ homeZone: 'Gotham' });
    expect(s.home).toBe(browserZone());
    expect(s.homeUnknown).toBe('Gotham');
  });

  it('keeps working hours sane', () => {
    expect(readSettings({ workStart: 9, workEnd: 17 })).toMatchObject({ workStart: 9, workEnd: 17 });
    expect(readSettings({ workStart: 18, workEnd: 9 })).toMatchObject({ workStart: 8, workEnd: 20 });
    expect(readSettings({ workStart: 'x', workEnd: 99 })).toMatchObject({ workStart: 8, workEnd: 24 });
  });
});

describe('settings copy for slots', () => {
  it('keeps the newest settings in storage from the background', async () => {
    const api = fakeApi({ settings: { favouriteZones: 'Berlin' } });
    plugin.activate(api);
    await Promise.resolve();
    expect(api.storageSnapshot()[SETTINGS_MIRROR_KEY]).toEqual({ favouriteZones: 'Berlin' });
    api.changeSettings({ favouriteZones: 'Tokyo' });
    await Promise.resolve();
    expect(await readMirroredSettings(api)).toEqual({ favouriteZones: 'Tokyo' });
  });

  it('ignores a broken copy', async () => {
    const api = fakeApi();
    await api.storage.set(SETTINGS_MIRROR_KEY, ['x']);
    expect(await readMirroredSettings(api)).toBeNull();
  });
});

describe('zones of people', () => {
  it('stores zones by lower-cased address and forgets them', async () => {
    const api = fakeApi();
    await setAddressZone(api.storage, 'Bob@Example.org', 'America/New_York');
    expect(api.storageSnapshot().addressZones).toEqual({ 'bob@example.org': 'America/New_York' });
    const map = await loadAddressZones(api.storage);
    expect(zoneFor(map, 'BOB@example.org')).toBe('America/New_York');
    await setAddressZone(api.storage, 'bob@example.org', null);
    expect(await loadAddressZones(api.storage)).toEqual({});
  });

  it('refuses bad addresses and zones', async () => {
    const api = fakeApi();
    await expect(setAddressZone(api.storage, 'not an address', 'UTC')).rejects.toThrow('invalid-address');
    await expect(setAddressZone(api.storage, 'a@b.c', 'Mars/Base')).rejects.toThrow('invalid-zone');
    expect(api.storageSnapshot().addressZones).toBeUndefined();
  });

  it('drops broken entries it finds in storage', async () => {
    const api = fakeApi();
    await api.storage.set('addressZones', { 'a@b.c': 'Asia/Tokyo', 'x@y.z': 'Nope/Nope', junk: 'UTC' });
    expect(await loadAddressZones(api.storage)).toEqual({ 'a@b.c': 'Asia/Tokyo' });
  });

  it('keeps at most MAX_ENTRIES, dropping the oldest', async () => {
    const api = fakeApi();
    const full = {};
    for (let i = 0; i < MAX_ENTRIES; i++) full[`p${i}@x.org`] = 'UTC';
    await api.storage.set('addressZones', full);
    const map = await setAddressZone(api.storage, 'new@x.org', 'Asia/Tokyo');
    expect(Object.keys(map)).toHaveLength(MAX_ENTRIES);
    expect(map['p0@x.org']).toBeUndefined();
    expect(map['new@x.org']).toBe('Asia/Tokyo');
  });
});

describe('settings section', () => {
  afterEach(() => setApi(null));

  it('is offered as a slot', () => {
    expect(plugin.slots['settings-section'].component).toBe(SettingsSection);
  });

  it('lists the favourites as understood and points out unknown entries', () => {
    setApi(fakeApi({
      settings: { homeZone: 'Europe/Berlin', favouriteZones: 'New York, Tokio' },
      translations: manifest.locales,
    }));
    const html = renderToStaticMarkup(h(SettingsSection));
    expect(html).toContain('Your time zone');
    expect(html).toContain('Europe/Berlin');
    expect(html).toContain('America/New_York');
    expect(html).toContain('Not recognised: Tokio');
  });

  it('speaks the user\'s language', () => {
    const api = fakeApi({ locale: 'de', settings: {}, translations: manifest.locales });
    setApi(api);
    const html = renderToStaticMarkup(h(SettingsSection));
    expect(html).toContain('Ihre Zeitzone');
    expect(html).toContain('Bevorzugte Zeitzonen');
  });
});

describe('manifest', () => {
  const LOCALES = ['ar', 'ca', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hu', 'it', 'ja', 'ko', 'lv', 'mn', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'uk', 'zh', 'zh-TW'];
  it('has every string in every webmail language', () => {
    expect(Object.keys(manifest.locales).sort()).toEqual([...LOCALES].sort());
    const keys = Object.keys(manifest.locales.en).sort();
    for (const l of LOCALES) expect(Object.keys(manifest.locales[l]).sort(), l).toEqual(keys);
  });
  it('has no escaped characters in the translations', () => {
    for (const l of LOCALES) for (const v of Object.values(manifest.locales[l])) expect(v).not.toMatch(/\\u[0-9a-f]{4}/i);
  });
});
