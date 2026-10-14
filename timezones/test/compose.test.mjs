// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { composeLine, nextFullHour } from '../src/lib/compose.js';
import { setApi } from '../src/host.js';
import { ComposeButton, ComposeDialog } from '../src/ui/compose-time.jsx';
import plugin from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };
import { button, click, mount, type } from './dom.mjs';

describe('compose logic', () => {
  it('starts at the next full hour in your zone', () => {
    expect(nextFullHour(Date.parse('2026-10-14T13:20:00Z'), 'Europe/Berlin')).toEqual({ date: '2026-10-14', time: '16:00' });
    expect(nextFullHour(Date.parse('2026-10-14T21:59:00Z'), 'Europe/Berlin')).toEqual({ date: '2026-10-15', time: '00:00' });
  });
  it('writes the picked time in each zone, reading it in your zone', () => {
    expect(composeLine({ date: '2026-10-14', time: '15:00', fromZone: 'Europe/Berlin', zones: ['Europe/Berlin', 'America/New_York'], locale: 'de' }))
      .toBe('15:00 Berlin / 09:00 New York');
    expect(composeLine({ date: '2026-10-14', time: '15:00', fromZone: 'America/New_York', zones: ['Europe/Berlin'], locale: 'de' }))
      .toBe('21:00 Berlin');
  });
  it('gives nothing without zones or a time', () => {
    expect(composeLine({ date: '2026-10-14', time: '15:00', fromZone: 'UTC', zones: [] })).toBe('');
    expect(composeLine({ date: '2026-10-14', time: '', fromZone: 'UTC', zones: ['UTC'] })).toBe('');
  });
});

describe('composer button and dialog', () => {
  afterEach(() => { setApi(null); vi.useRealTimers(); delete navigator.clipboard; });

  const setup = (settings = {}) => {
    const api = fakeApi({ settings: { homeZone: 'Europe/Berlin', favouriteZones: 'New York', ...settings }, translations: manifest.locales, locale: 'en-GB', handlers: { 'ui.openDialog': async () => null } });
    setApi(api);
    return api;
  };

  it('are offered in the composer and as the dialog', () => {
    expect(plugin.slots['composer-toolbar'].component).toBe(ComposeButton);
    expect(plugin.slots['plugin-dialog'].component).toBe(ComposeDialog);
  });

  it('opens the dialog from the button', async () => {
    const api = setup();
    const ui = await mount(ComposeButton);
    await click(button(ui.container, 'Time zones'));
    expect(api.calls('ui.openDialog')).toEqual([{ method: 'ui.openDialog', args: [{ title: 'Time in several zones', slot: 'plugin-dialog', width: 520 }] }]);
    await ui.unmount();
  });

  it('builds the line from the time and the ticked zones', async () => {
    setup();
    const ui = await mount(ComposeDialog, { onResult: () => {} });
    const [date, time] = ui.$$('input[type="date"], input[type="time"]');
    await type(date, '2026-10-14');
    await type(time, '15:00');
    expect(ui.$('[data-tz="compose-text"]').value).toBe('15:00 Berlin / 09:00 New York');
    // Untick Berlin.
    await click(ui.$$('input[type="checkbox"]')[0]);
    expect(ui.$('[data-tz="compose-text"]').value).toBe('09:00 New York');
    // Add Tokyo.
    await click(button(ui.container, 'Add a time zone'));
    await type(ui.$$('input:not([type])')[0] ?? ui.$('input[list]'), 'Tokyo');
    await click(button(ui.container, 'Add'));
    expect(ui.$('[data-tz="compose-text"]').value).toBe('09:00 New York / 22:00 Tokyo');
    await ui.unmount();
  });

  it('says to pick a zone when none is ticked', async () => {
    setup({ favouriteZones: '' });
    const ui = await mount(ComposeDialog, {});
    await click(ui.$$('input[type="checkbox"]')[0]);
    expect(ui.text()).toContain('Pick at least one time zone.');
    expect(button(ui.container, 'Copy').disabled).toBe(true);
    await ui.unmount();
  });

  it('copies the line', async () => {
    setup();
    const writeText = vi.fn(async () => {});
    navigator.clipboard = { writeText };
    const ui = await mount(ComposeDialog, {});
    const text = ui.$('[data-tz="compose-text"]').value;
    await click(button(ui.container, 'Copy'));
    expect(writeText).toHaveBeenCalledWith(text);
    expect(ui.$('[role="status"]').textContent).toBe('Copied. Paste it into your message.');
    await ui.unmount();
  });

  it('explains when the browser blocks copying and leaves the text selected', async () => {
    setup();
    navigator.clipboard = { writeText: vi.fn(async () => { throw new Error('NotAllowedError'); }) };
    document.execCommand = vi.fn(() => false);
    const ui = await mount(ComposeDialog, {});
    await click(button(ui.container, 'Copy'));
    expect(ui.$('[role="status"]').textContent).toContain('Copying is blocked here');
    const field = ui.$('[data-tz="compose-text"]');
    expect(field.selectionEnd - field.selectionStart).toBe(field.value.length);
    await ui.unmount();
  });

  it('closes with nothing', async () => {
    setup();
    const onResult = vi.fn();
    const ui = await mount(ComposeDialog, { onResult });
    await click(button(ui.container, 'Close'));
    expect(onResult).toHaveBeenCalledWith(null);
    await ui.unmount();
  });
});
