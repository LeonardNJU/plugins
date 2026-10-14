// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeTranslateBanner } from '../src/lib/banner.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'translate', 'manifest.json'), 'utf8'));
afterEach(cleanup);

function setup(answer) {
  let resolve;
  const api = fakeApi({
    translations: manifest.locales,
    settings: { targetLanguage: 'en' },
    handlers: { 'http.post': () => (answer ? Promise.resolve(answer) : new Promise((r) => { resolve = r; })) },
  });
  const Banner = makeTranslateBanner(React, api);
  render(React.createElement(Banner, { email: { id: 'm', text: 'Hallo Welt\n\nZweiter Absatz' } }));
  return { api, resolve: (v) => resolve(v) };
}

describe('translate bar', () => {
  it('is an info bar with a bar button that translates the message', async () => {
    const { api, resolve } = setup();
    const bar = document.querySelector('.bk-infobar');
    expect(bar.getAttribute('data-tone')).toBe('info');
    expect(bar.textContent).toMatch('Translate this message into EN?');

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(screen.getByRole('button', { name: 'Translate' }).disabled).toBe(true);
    expect(api.calls('http.post')[0].args[1]).toMatchObject({ text: 'Hallo Welt\n\nZweiter Absatz', target: 'en', source: 'auto' });

    await act(async () => { resolve({ ok: true, status: 200, data: { translatedText: 'Hello world\n\nSecond paragraph', detectedSource: 'de' } }); });
    expect(bar.textContent).toMatch('Translated from DE to EN');
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByText('Hello world').tagName).toBe('P');
    expect(screen.getByText('Second paragraph').tagName).toBe('P');
    expect(screen.getByRole('button', { name: 'Translate again' })).toBeTruthy();
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('shows a failure in the danger tone', async () => {
    setup({ ok: false, status: 502, data: { error: 'upstream down' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Translate' })); });
    expect(screen.getByText('upstream down').getAttribute('data-tone')).toBe('danger');
  });
});
