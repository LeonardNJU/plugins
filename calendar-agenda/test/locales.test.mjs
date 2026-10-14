// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeAgenda, POSITION_TO_SLOT } from '../src/lib/agenda.js';

// jsdom gives import.meta.url an http scheme; tests run from the repo root.
const DIR = path.join(process.cwd(), 'calendar-agenda');
const raw = readFileSync(path.join(DIR, 'manifest.json'), 'utf8');
const manifest = JSON.parse(raw);
const WEBMAIL_LOCALES = ['ar', 'ca', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hu', 'it', 'ja', 'ko', 'lv', 'mn', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'uk', 'zh', 'zh-TW'];
const en = manifest.locales.en;
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
// "Agenda" is the right word in several languages.
const MAY_MATCH_ENGLISH = ['header.title'];

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
    const same = Object.keys(en).filter((k) => manifest.locales[locale][k] === en[k] && !MAY_MATCH_ENGLISH.includes(k));
    expect(same, locale).toEqual([]);
  });

  it('every key the code uses exists', () => {
    const used = new Set();
    for (const file of sourceFiles(path.join(DIR, 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThanOrEqual(8);
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });

  it('user setting labels and position choices are translation keys, so Settings shows them translated', () => {
    for (const field of Object.values(manifest.settingsSchema)) {
      expect(en[field.label], field.label).toBeTruthy();
      if (field.description) expect(en[field.description], field.description).toBeTruthy();
      for (const option of field.options ?? []) expect(en[option], option).toBeTruthy();
    }
    // The stored values stay the English names the slot wiring reads.
    expect(manifest.settingsSchema.position.options.sort()).toEqual(Object.keys(POSITION_TO_SLOT).sort());
  });

  it('is written as real characters, not \\u escapes', () => {
    expect(raw).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });
});

// A made-up language whose every string is "‹key›" (plus the placeholders):
// any text still hard-coded in English shows up as a failed lookup here.
const pseudo = Object.fromEntries(Object.entries(en).map(([k, v]) => [k, [`‹${k}›`, ...placeholders(v).map((p) => `{${p}}`)].join(' ')]));
const NOW = () => new Date(2026, 9, 14, 9, 0);
const events = [
  { id: 'a', title: 'Standup', start: new Date(2026, 9, 14, 10, 0).toISOString() },
  { id: 'b', title: 'Offsite', start: new Date(2026, 9, 15, 0, 0).toISOString(), allDay: true },
  { id: 'c', title: 'Party', start: new Date(2026, 9, 14, 0, 0).toISOString(), allDay: true },
];

async function show(slot, response) {
  const api = fakeApi({ locale: 'xx', translations: { en, xx: pseudo }, settings: { daysAhead: 7 }, handlers: { 'http.post': async () => response } });
  const Agenda = makeAgenda(React, api, { slot, now: NOW });
  await act(async () => { render(React.createElement(Agenda)); });
}

describe('the agenda in another language', () => {
  it('names today, tomorrow and all-day events from the locale', async () => {
    await show('email-detail-sidebar', { ok: true, status: 200, data: { events } });
    expect(screen.getByRole('heading', { name: '‹header.title›' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem').map((r) => r.textContent);
    expect(rows[1]).toBe('Offsite‹day.tomorrow›');
    expect(rows[2]).toBe('Party‹event.all_day›');
  });

  it.each([
    ['empty', { ok: true, status: 200, data: { events: [] } }, '‹state.empty› 7'],
    ['signed out', { ok: false, status: 401 }, '‹state.unauth›'],
    ['failing', { ok: false, status: 500, data: { error: 'boom' } }, '‹state.error› boom'],
  ])('says it is %s in the locale', async (_name, response, text) => {
    await show('sidebar-section', response);
    expect(document.body.textContent).toBe(text);
  });

  it('labels the top banner from the locale', async () => {
    await show('app-top-banner', { ok: true, status: 200, data: { events } });
    expect(document.querySelector('.bk-infobar').textContent.startsWith('‹header.title›')).toBe(true);
  });
});
