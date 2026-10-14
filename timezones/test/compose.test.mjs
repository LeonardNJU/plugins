// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { SlotPropsContext } from '@plugin-host/ui';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { composeLine, nextFullHour } from '../src/lib/compose.js';
import { setApi } from '../src/host.js';
import { ComposeDialog } from '../src/ui/compose-time.jsx';
import plugin from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };
import { button, byLabel, click, mount, type } from './dom.mjs';

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

describe('composer Options entry and dialog', () => {
  afterEach(() => { setApi(null); vi.useRealTimers(); delete navigator.clipboard; });

  const setup = (settings = {}, handlers = {}) => {
    const api = fakeApi({ settings: { homeZone: 'Europe/Berlin', favouriteZones: 'New York', ...settings }, translations: manifest.locales, locale: 'en-GB', handlers });
    setApi(api);
    return api;
  };
  const preview = (ui) => byLabel(ui.container, 'Text to paste').value;
  const clickEntry = (surface = 'composer-options-menu', actionId = 'insert-zone-times', context = { composerId: 'c7' }) => plugin.hooks.onAction({ surface, actionId, context });

  it('has no frame in the composer, only the dialog', () => {
    expect(plugin.slots['composer-toolbar']).toBeUndefined();
    expect(plugin.slots['plugin-dialog'].component).toBe(ComposeDialog);
    expect(manifest.permissions).toContain('compose:write');
    expect(manifest.permissions).not.toContain('compose:open');
  });

  it('puts an entry into the composer\'s Options menu', async () => {
    const api = setup();
    plugin.activate(api);
    await Promise.resolve();
    expect(api.calls('ui.setActions')).toEqual([{ method: 'ui.setActions', args: ['composer-options-menu', [{ id: 'insert-zone-times', label: 'Insert time in other zones…', icon: 'clock' }]] }]);
  });

  it('titles the world clock section in the sidebar', async () => {
    const api = setup();
    plugin.activate(api);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls('ui.setSectionTitle')).toEqual([{ method: 'ui.setSectionTitle', args: ['World clock'] }]);
  });

  it('opens the dialog for the composer that was clicked, and ignores other actions', () => {
    const api = setup();
    clickEntry();
    clickEntry('composer-attach-menu');
    clickEntry('composer-options-menu', 'other');
    clickEntry('composer-options-menu', 'insert-zone-times', {});
    expect(api.calls('ui.openDialog')).toEqual([{ method: 'ui.openDialog', args: [{ title: 'Time in several zones', slot: 'plugin-dialog', width: 520, extraProps: { composerId: 'c7' } }] }]);
  });

  it('inserts the line at the caret of the clicked composer through api.composer.replaceSelection', async () => {
    const api = setup({}, { 'composer.replaceSelection': async () => true });
    clickEntry('composer-options-menu', 'insert-zone-times', { composerId: 'composer-42' });
    const { extraProps } = api.calls('ui.openDialog')[0].args[0];
    const onResult = vi.fn();
    const ui = await mount(ComposeDialog, { ...extraProps, onResult });
    await type(byLabel(ui.container, 'Date'), '2026-10-14');
    await type(byLabel(ui.container, 'Time in Berlin'), '15:00');
    await click(button(ui.container, 'Insert'));
    expect(api.calls('composer.replaceSelection')).toEqual([{ method: 'composer.replaceSelection', args: ['composer-42', { text: '15:00 Berlin / 09:00 New York' }] }]);
    expect(onResult).toHaveBeenCalledWith('15:00 Berlin / 09:00 New York');
    await ui.unmount();
  });

  it('keeps the dialog open and offers Copy when the composer refuses the text', async () => {
    const api = setup({}, { 'composer.replaceSelection': async () => false });
    const onResult = vi.fn();
    const ui = await mount(ComposeDialog, { composerId: 'c1', onResult });
    expect(button(ui.container, 'Copy')).toBeUndefined();
    await click(button(ui.container, 'Insert'));
    expect(api.calls('composer.replaceSelection')).toHaveLength(1);
    expect(onResult).not.toHaveBeenCalled();
    expect(ui.$('[role="alert"]').textContent).toBe('Could not insert the text. Use Copy and paste it instead.');
    expect(button(ui.container, 'Copy')).toBeTruthy();
    await ui.unmount();
  });

  it('hands Cancel and Insert to the host\'s dialog footer', async () => {
    setup();
    const footer = vi.fn();
    const Dialog = (props) => createElement(SlotPropsContext.Provider, { value: { setDialogButtons: footer } }, createElement(ComposeDialog, props));
    const ui = await mount(Dialog, { composerId: 'c1', onResult: () => {} });
    expect(footer).toHaveBeenLastCalledWith([
      { id: 'cancel', label: 'Cancel', variant: 'secondary' },
      { id: 'insert', label: 'Insert', variant: 'primary', disabled: false, busy: false },
    ]);
    expect(button(ui.container, 'Insert')).toBeUndefined();
    await ui.unmount();
  });

  it('offers Copy instead of Insert without a composer', async () => {
    setup();
    const ui = await mount(ComposeDialog, { onResult: () => {} });
    expect(button(ui.container, 'Insert')).toBeUndefined();
    expect(button(ui.container, 'Copy').dataset.variant).toBe('primary');
    await ui.unmount();
  });

  it('builds the line from the time and the ticked zones', async () => {
    setup();
    const ui = await mount(ComposeDialog, { onResult: () => {} });
    await type(byLabel(ui.container, 'Date'), '2026-10-14');
    await type(byLabel(ui.container, 'Time in Berlin'), '15:00');
    expect(preview(ui)).toBe('15:00 Berlin / 09:00 New York');
    // Untick Berlin.
    await click(byLabel(ui.container, 'Berlin'));
    expect(preview(ui)).toBe('09:00 New York');
    // Add Tokyo.
    await click(button(ui.container, 'Add a time zone'));
    await type(byLabel(ui.container, 'Add a time zone'), 'Tokyo');
    await click(button(ui.container, 'Add'));
    expect(preview(ui)).toBe('09:00 New York / 22:00 Tokyo');
    await ui.unmount();
  });

  it('says to pick a zone when none is ticked', async () => {
    setup({ favouriteZones: '' });
    const ui = await mount(ComposeDialog, { composerId: 'c1' });
    await click(byLabel(ui.container, 'Berlin'));
    expect(ui.text()).toContain('Pick at least one time zone.');
    expect(button(ui.container, 'Insert').disabled).toBe(true);
    await ui.unmount();
  });

  it('copies the line', async () => {
    setup();
    const writeText = vi.fn(async () => {});
    navigator.clipboard = { writeText };
    const ui = await mount(ComposeDialog, {});
    const text = preview(ui);
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
    const field = byLabel(ui.container, 'Text to paste');
    expect(field.selectionEnd - field.selectionStart).toBe(field.value.length);
    await ui.unmount();
  });

  it('closes with nothing on Cancel', async () => {
    const api = setup();
    const onResult = vi.fn();
    const ui = await mount(ComposeDialog, { composerId: 'c1', onResult });
    await click(button(ui.container, 'Cancel'));
    expect(onResult).toHaveBeenCalledWith(null);
    expect(api.calls('composer.replaceSelection')).toHaveLength(0);
    await ui.unmount();
  });
});
