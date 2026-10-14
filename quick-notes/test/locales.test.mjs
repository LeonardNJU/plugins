// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeNoteBanner, makeNotesPanel } from '../src/lib/notes.js';

// jsdom gives import.meta.url an http scheme; tests run from the repo root.
const DIR = path.join(process.cwd(), 'quick-notes');
const raw = readFileSync(path.join(DIR, 'manifest.json'), 'utf8');
const manifest = JSON.parse(raw);
const WEBMAIL_LOCALES = ['ar', 'ca', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hu', 'it', 'ja', 'ko', 'lv', 'mn', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'uk', 'zh', 'zh-TW'];
const en = manifest.locales.en;
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory()
    ? sourceFiles(path.join(dir, d.name))
    : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
}

afterEach(cleanup);

describe('translations', () => {
  it('cover every webmail language', () => {
    expect(Object.keys(manifest.locales).sort()).toEqual([...WEBMAIL_LOCALES].sort());
  });

  it.each(WEBMAIL_LOCALES)('%s has every key with the same placeholders', (locale) => {
    const table = manifest.locales[locale];
    expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(table)) {
      expect(text.trim(), `${locale} ${key}`).not.toBe('');
      expect(placeholders(text), `${locale} ${key}`).toEqual(placeholders(en[key]));
    }
  });

  it.each(WEBMAIL_LOCALES.filter((l) => l !== 'en'))('%s is translated, not English copied over', (locale) => {
    const same = Object.keys(en).filter((k) => manifest.locales[locale][k] === en[k]);
    expect(same, locale).toEqual([]);
  });

  it('every key the code uses exists', () => {
    const used = new Set();
    for (const file of sourceFiles(path.join(DIR, 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThanOrEqual(7);
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });

  it('user setting labels are translation keys, so Settings shows them translated', () => {
    for (const field of Object.values(manifest.settingsSchema)) {
      expect(en[field.label], field.label).toBeTruthy();
      if (field.description) expect(en[field.description], field.description).toBeTruthy();
    }
  });

  it('is written as real characters, not \\u escapes', () => {
    expect(raw).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });
});

// A made-up language whose every string is "‹key›" (plus the placeholders):
// any text still hard-coded in English shows up as a failed lookup here.
const pseudo = Object.fromEntries(Object.entries(en).map(([k, v]) => [k, [`‹${k}›`, ...placeholders(v).map((p) => `{${p}}`)].join(' ')]));
const pseudoApi = () => fakeApi({ locale: 'xx', translations: { en, xx: pseudo } });

describe('the note UI in another language', () => {
  it('draws the banner from the locale', () => {
    render(React.createElement(makeNoteBanner(React, pseudoApi())));
    expect(document.querySelector('.bk-infobar').textContent).toBe('‹banner.title›');
  });

  it('draws the panel from the locale: heading, field, hint, placeholder and saved time', async () => {
    const api = pseudoApi();
    await api.storage.set('notes', { m1: { text: 'call back', updatedAt: '2026-10-14T09:00:00.000Z' } });
    const Panel = makeNotesPanel(React, api);
    await act(async () => { render(React.createElement(Panel, { email: { id: 'm1' } })); });
    expect(screen.getByRole('heading', { name: '‹panel.title›' })).toBeTruthy();
    const box = screen.getByLabelText('‹panel.label›');
    expect(box.getAttribute('placeholder')).toBe('‹panel.placeholder›');
    expect(screen.getByText('‹panel.hint›')).toBeTruthy();
    expect(screen.getByText(/^‹panel\.saved› \S/)).toBeTruthy();
    for (const text of Object.values(en)) expect(document.body.textContent).not.toContain(text);
  });

  it('draws the no-message state from the locale', async () => {
    const Panel = makeNotesPanel(React, pseudoApi());
    await act(async () => { render(React.createElement(Panel, {})); });
    expect(document.body.textContent).toContain('‹panel.title›');
    expect(document.body.textContent).toContain('‹panel.empty›');
  });
});
