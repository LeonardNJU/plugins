// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { setApi } from '../src/host.js';
import { readSettings } from '../src/lib/settings.js';
import { WorldClock } from '../src/ui/world-clock.jsx';
import plugin, { slotsFor } from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };
import { mount, settle } from './dom.mjs';
import { act } from 'react';

describe('world clock', () => {
  afterEach(() => { setApi(null); vi.useRealTimers(); });

  it('is not offered unless turned on', () => {
    expect(plugin.slots['sidebar-section']).toBeUndefined();
    expect(slotsFor(readSettings({}))['sidebar-section']).toBeUndefined();
    expect(slotsFor(readSettings({ worldClock: true }))['sidebar-section'].component).toBe(WorldClock);
    expect(manifest.settingsSchema.worldClock.default).toBe(false);
  });

  it('shows your zone and the favourites, dims those outside working hours, and keeps ticking', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-14T13:00:00Z'));
    setApi(fakeApi({ settings: { homeZone: 'Europe/Berlin', favouriteZones: 'New York, Tokyo', worldClock: true }, translations: manifest.locales, locale: 'en-GB' }));
    const ui = await mount(WorldClock);
    const rows = () => ui.$$('[data-zone]');
    expect(rows().map((r) => r.dataset.zone)).toEqual(['Europe/Berlin', 'America/New_York', 'Asia/Tokyo']);
    expect(rows()[0].textContent).toContain('15:00');
    expect(rows()[1].textContent).toContain('09:00');
    expect(rows()[2].textContent).toContain('22:00');
    expect(rows().map((r) => r.dataset.outside)).toEqual(['false', 'false', 'true']);
    await act(async () => { vi.advanceTimersByTime(30 * 60_000); });
    await settle();
    expect(rows()[0].textContent).toContain('15:30');
    await ui.unmount();
  });

  it('marks a zone already on the next day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T20:00:00Z'));
    setApi(fakeApi({ settings: { homeZone: 'Europe/Berlin', favouriteZones: 'Auckland' }, translations: manifest.locales, locale: 'en-GB' }));
    const ui = await mount(WorldClock);
    expect(ui.$('[data-zone="Pacific/Auckland"] [data-tz="day"]').textContent.trim()).toBe('+1');
    expect(ui.$('[data-zone="Europe/Berlin"] [data-tz="day"]')).toBeNull();
    await ui.unmount();
  });

  it('says how to add zones when there are none', async () => {
    setApi(fakeApi({ settings: { homeZone: 'Europe/Berlin' }, translations: manifest.locales }));
    const ui = await mount(WorldClock);
    expect(ui.text()).toContain('Add favourite time zones in Settings to see them here.');
    await ui.unmount();
  });
});
