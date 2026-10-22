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
const standupStart = new Date(2026, 9, 14, 10, 0);
const events = [
  {
    id: 'a', title: 'Standup', start: '2026-10-14T10:00:00', duration: 'PT15M', isAllDay: false,
    utcStart: standupStart.toISOString(), utcEnd: new Date(standupStart.getTime() + 15 * 60_000).toISOString(),
  },
  { id: 'b', title: 'Offsite', start: '2026-10-15T00:00:00', duration: 'P1D', isAllDay: true, utcStart: null, utcEnd: null },
  { id: 'c', title: 'Party', start: '2026-10-14T00:00:00', duration: 'P1D', isAllDay: true, utcStart: null, utcEnd: null },
  { id: 'd', title: '', start: '2026-10-14T00:00:00', duration: 'P1D', isAllDay: true, utcStart: null, utcEnd: null },
];

async function show(slot, getEvents) {
  const api = fakeApi({ locale: 'xx', translations: { en, xx: pseudo }, settings: { daysAhead: 7 }, handlers: { 'calendar.getEvents': getEvents } });
  const Agenda = makeAgenda(React, api, { slot, now: NOW });
  await act(async () => { render(React.createElement(Agenda)); });
}

describe('the agenda in another language', () => {
  it('names today, tomorrow, all-day and untitled events from the locale', async () => {
    await show('email-detail-sidebar', async () => events);
    expect(screen.getByRole('heading', { name: '‹header.title›' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem').map((r) => r.textContent);
    expect(rows).toEqual([
      'Party‹event.all_day›',
      '‹event.untitled›‹event.all_day›',
      expect.stringMatching(/^Standup/),
      'Offsite‹event.all_day›',
    ]);
    expect(screen.getAllByRole('list').map((l) => l.getAttribute('aria-label'))).toEqual(['‹day.today›', '‹day.tomorrow›']);
  });

  it.each([
    ['empty', async () => [], '‹state.empty› 7'],
    ['signed out', async () => { throw new Error('calendar.getEvents: no active session'); }, '‹state.unauth›'],
    ['failing', async () => { throw new Error('boom'); }, '‹state.error› boom'],
  ])('says it is %s in the locale', async (_name, getEvents, text) => {
    await show('sidebar-section', getEvents);
    expect(document.body.textContent).toBe(text);
  });

  it('labels the top banner from the locale', async () => {
    await show('app-top-banner', async () => events);
    expect(document.querySelector('.bk-infobar').textContent.startsWith('‹header.title›')).toBe(true);
  });
});
