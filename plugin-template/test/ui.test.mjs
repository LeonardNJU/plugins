// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { SlotPropsContext } from '../../test-utils/ui-kit.mjs';
import { makeDialog, makeSection, ITEMS_KEY } from '../src/lib/ui.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'plugin-template', 'manifest.json'), 'utf8'));
afterEach(cleanup);

describe('sidebar section', () => {
  it('shows the empty line and an add row that opens the dialog and saves the item', async () => {
    const api = fakeApi({ translations: manifest.locales, handlers: { 'ui.openDialog': async () => 'Groceries' } });
    const Section = makeSection(React, api);
    await act(async () => { render(React.createElement(Section)); });
    expect(screen.getByText('Nothing here yet')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add item' })); });
    expect(api.calls('ui.openDialog')[0].args[0]).toMatchObject({ slot: 'plugin-dialog', title: 'Add item' });
    expect((await api.storage.get(ITEMS_KEY)).map((i) => i.name)).toEqual(['Groceries']);
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });
});

describe('dialog', () => {
  it('hands Cancel and Add to the host footer, Add disabled until a name is typed', async () => {
    const api = fakeApi({ translations: manifest.locales, locale: 'de' });
    const Dialog = makeDialog(React, api);
    const sent = [];
    let result;
    await act(async () => {
      render(React.createElement(SlotPropsContext.Provider, { value: { setDialogButtons: (b) => sent.push(b) } },
        React.createElement(Dialog, { onResult: (v) => { result = v; } })));
    });
    expect(sent.at(-1)).toEqual([
      { id: 'cancel', label: 'Abbrechen', variant: 'secondary' },
      { id: 'add', label: 'Hinzufügen', variant: 'primary', disabled: true },
    ]);
    // No buttons in the dialog body itself.
    expect(screen.queryByRole('button')).toBeNull();

    await act(async () => { fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Milk ' } }); });
    expect(sent.at(-1)[1].disabled).toBe(false);
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });
    expect(result).toBe('Milk');
  });
});
