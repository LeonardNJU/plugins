// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SlotPropsContext } from '../../test-utils/ui-kit.mjs';
import { SURFACES } from '../src/lib/surfaces.js';

afterEach(cleanup);

const show = (name, props = {}) => render(React.createElement(SURFACES[name], props));

describe('slot showcase', () => {
  it('fills every frame slot of the catalogue', () => {
    const catalog = path.resolve(process.cwd(), '..', 'jmap-webmail-plugins', 'lib', 'plugin-slot-catalog.ts');
    let text;
    try { text = readFileSync(catalog, 'utf8'); } catch { return; } // webmail checkout not next to this one
    const frames = [...text.matchAll(/^\s+'([a-z-]+)': S\('[a-z-]+', 'frame'/gm)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThan(20);
    expect(Object.keys(SURFACES).sort()).toEqual(frames.sort());
  });

  it('draws with the kit only: no inline colours anywhere', () => {
    for (const name of Object.keys(SURFACES)) {
      const { container, unmount } = show(name, { email: {}, emailIds: ['a', 'b'] });
      for (const el of container.querySelectorAll('[style]')) {
        throw new Error(`${name} has an inline style: ${el.getAttribute('style')}`);
      }
      expect(container.textContent, name).toMatch(name === 'navigation-rail-bottom' ? /rail/ : new RegExp(`slot: ${name}`));
      unmount();
    }
  });

  it('reader banners are info bars and the sidebar section is sidebar rows', () => {
    show('email-banner', { email: {} });
    expect(document.querySelector('.bk-infobar').textContent).toMatch('props: email');
    cleanup();
    show('sidebar-section', { mailboxId: 'x' });
    expect(screen.getByRole('button', { name: 'Add row' })).toBeTruthy();
  });

  it('the dialog puts Cancel and its main button in the host footer', async () => {
    const sent = [];
    await act(async () => {
      render(React.createElement(SlotPropsContext.Provider, { value: { setDialogButtons: (b) => sent.push(b) } },
        React.createElement(SURFACES['plugin-dialog'], { onResult: () => {} })));
    });
    expect(sent.at(-1).map((b) => [b.id, b.variant])).toEqual([['cancel', 'secondary'], ['ok', 'primary']]);
    expect(screen.queryByRole('button', { name: /Close with onResult/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'A checkbox' })).toBeTruthy();
  });
});
