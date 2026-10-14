// @vitest-environment jsdom
// "From Nextcloud" in the composer's Attach menu: the click's composerId
// goes to the picker dialog, and the picker attaches to that composer.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { onAction, registerActions, slots } from '../src/index.js';
import { PickerDialog } from '../src/ui/picker-dialog.js';
import manifest from '../manifest.json' with { type: 'json' };

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const h = React.createElement;
const FILES = [
  { path: '/Documents', name: 'Documents', isFolder: true, size: 0, modified: 0 },
  { path: '/a.pdf', name: 'a.pdf', isFolder: false, size: 3, type: 'application/pdf', modified: 0 },
  { path: '/b.png', name: 'b.png', isFolder: false, size: 2, type: 'image/png', modified: 0 },
];

function fakeClient() {
  return {
    list: async () => FILES,
    recent: async () => [],
    search: async () => [],
    download: async (entry) => new Uint8Array(entry.size),
    share: async (path) => ({ url: `https://c.example/s${path}` }),
    generatePassword: async () => 'pw',
  };
}

/** An api whose openDialog renders the picker like the host does, with the dialog's extraProps. */
function apiWithPicker({ attach = async () => true } = {}) {
  const client = fakeClient();
  let api;
  api = fakeApi({
    translations: manifest.locales,
    handlers: {
      'jmap.uploadBlob': async (bytes, name, type) => ({ blobId: `blob-${name}`, size: bytes.byteLength, type }),
      'composer.attach': attach,
      'ui.openDialog': (opts) => new Promise((resolve) => {
        act(() => { render(h(PickerDialog, { ...opts.extraProps, api, client, onResult: resolve })); });
      }),
    },
  });
  return api;
}

function row(name) {
  return screen.getByText(name).closest('[role="listitem"]');
}

describe('the Attach menu entry', () => {
  it('reports when the composer is gone instead of losing the links', async () => {
    const api = fakeApi({ translations: manifest.locales, handlers: {
      'ui.openDialog': async () => ({ action: 'links', links: [{ id: 'x', name: 'n', url: 'https://c/s/1' }] }),
      'composer.replaceSelection': async () => { throw new Error('composer.replaceSelection: that composer is not open any more'); },
    } });
    await onAction(api, { surface: 'composer-attach-menu', actionId: 'from-nextcloud', context: { composerId: 'c1' } });
    expect(api.calls('toast.error')).toHaveLength(1);
    expect(api.calls('toast.success')).toHaveLength(0);
  });

  it('is registered in the Attach menu instead of a composer slot', async () => {
    const api = fakeApi({ translations: manifest.locales });
    await registerActions(api);
    const call = api.calls('ui.setActions').find((c) => c.args[0] === 'composer-attach-menu');
    expect(call.args[1]).toEqual([{ id: 'from-nextcloud', label: 'From Nextcloud', icon: 'cloud' }]);
    expect(slots['composer-attachment-source']).toBeUndefined();
    expect(manifest.permissions).toContain('ui:composer-toolbar');
    expect(manifest.permissions).toContain('email:blob-write');
  });

  it('attaches the picked files to the composer that was clicked', async () => {
    const api = apiWithPicker();
    const done = onAction(api, { surface: 'composer-attach-menu', actionId: 'from-nextcloud', context: { composerId: 'composer-7' } });
    expect(api.calls('ui.openDialog')[0].args[0]).toMatchObject({ slot: 'plugin-dialog', extraProps: { view: 'picker', composerId: 'composer-7' } });
    await screen.findByText('a.pdf');
    fireEvent.click(row('a.pdf'));
    fireEvent.click(row('b.png'));
    expect(screen.getByText('Selected: 2 (5 B)')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Attach copies' })); });
    await done;
    expect(api.calls('composer.attach').map((c) => c.args)).toEqual([
      ['composer-7', { blobId: 'blob-a.pdf', name: 'a.pdf', type: 'application/pdf', size: 3 }],
      ['composer-7', { blobId: 'blob-b.png', name: 'b.png', type: 'image/png', size: 2 }],
    ]);
    expect(api.calls('toast.success')[0].args[0]).toBe('Attached from Nextcloud: 2');
  });

  it('says which file the composer refused and keeps it selected', async () => {
    const api = apiWithPicker({ attach: async (id, blob) => blob.name !== 'b.png' });
    void onAction(api, { surface: 'composer-attach-menu', actionId: 'from-nextcloud', context: { composerId: 'c1' } });
    await screen.findByText('a.pdf');
    fireEvent.click(row('a.pdf'));
    fireEvent.click(row('b.png'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Attach copies' })); });
    await screen.findByText("The composer didn't accept b.png. The message may be too large.");
    // a.pdf is in the message now; only b.png stays ticked for another try.
    expect(within(row('a.pdf')).getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(within(row('b.png')).getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    expect(api.calls('toast.success')[0].args[0]).toBe('Attached from Nextcloud: 1');
  });

  it('puts "Share as link" links into the message at the caret', async () => {
    const api = apiWithPicker();
    const done = onAction(api, { surface: 'composer-attach-menu', actionId: 'from-nextcloud', context: { composerId: 'c1' } });
    await screen.findByText('a.pdf');
    fireEvent.click(row('a.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Share as link…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add links' })); });
    await done;
    const [call] = api.calls('composer.replaceSelection');
    expect(call.args[0]).toBe('c1');
    expect(Object.keys(call.args[1])).toEqual(['html']);
    expect(call.args[1].html).toContain('<a href="https://c.example/s/a.pdf">a.pdf</a>');
    expect(call.args[1].html).toContain('Files shared with Nextcloud');
    expect(call.args[2]).toBeUndefined();
    expect(api.storageSnapshot()).not.toHaveProperty('pendingLinks');
    expect(api.calls('toast.success')[0].args[0]).toBe('Links added to the message: 1');
    expect(api.calls('composer.attach')).toHaveLength(0);
  });

  it('does nothing without a composer id or when the dialog is closed', async () => {
    const api = fakeApi({ translations: manifest.locales, handlers: { 'ui.openDialog': async () => null } });
    await onAction(api, { surface: 'composer-attach-menu', actionId: 'from-nextcloud', context: {} });
    expect(api.calls('ui.openDialog')).toHaveLength(0);
    await onAction(api, { surface: 'composer-attach-menu', actionId: 'from-nextcloud', context: { composerId: 'c1' } });
    expect(api.calls('ui.openDialog')).toHaveLength(1);
    expect(api.calls('toast.success')).toHaveLength(0);
    expect(api.calls('composer.replaceSelection')).toHaveLength(0);
  });
});
