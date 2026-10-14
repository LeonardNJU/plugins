// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeTranslateBanner } from '../src/lib/banner.js';

// jsdom gives import.meta.url an http scheme; tests run from the repo root.
const DIR = path.join(process.cwd(), 'translate');
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
    // Appended to the "Translated from" line, so it keeps its separator.
    expect(table.truncated.startsWith(' · '), `${locale} truncated`).toBe(true);
  });

  it.each(WEBMAIL_LOCALES.filter((l) => l !== 'en'))('%s is translated, not English copied over', (locale) => {
    // "auto" is the French and Polish word too.
    const sameWord = { fr: ['source_auto'], pl: ['source_auto'] }[locale] ?? [];
    const same = Object.keys(en).filter((k) => manifest.locales[locale][k] === en[k] && !sameWord.includes(k));
    expect(same, locale).toEqual([]);
  });

  it('every key the code uses exists', () => {
    const used = new Set();
    for (const file of sourceFiles(path.join(DIR, 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThanOrEqual(10);
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

function setup(answer) {
  const api = fakeApi({
    locale: 'xx',
    translations: { en, xx: pseudo },
    settings: { targetLanguage: 'de', maxChars: 10 },
    handlers: { 'http.post': async () => answer },
  });
  const Banner = makeTranslateBanner(React, api);
  render(React.createElement(Banner, { email: { id: 'm', text: 'Hello world, how are you?' } }));
}
const barText = () => document.querySelector('.bk-infobar').textContent;

describe('the translate bar in another language', () => {
  it('asks, translates and offers to translate again in the locale', async () => {
    setup({ ok: true, status: 200, data: { translatedText: 'Hallo Welt', detectedSource: 'en' } });
    expect(barText()).toContain('‹label›');
    expect(barText()).toContain('‹idle› DE');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '‹action.translate›' })); });
    expect(barText()).toContain('‹done› EN DE‹truncated›');
    expect(screen.getByRole('button', { name: '‹action.again›' })).toBeTruthy();
  });

  it('says when the message is already in the target language', async () => {
    setup({ ok: true, status: 200, data: { translatedText: 'Hallo', detectedSource: 'de' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '‹action.translate›' })); });
    expect(barText()).toContain('‹skipped› DE');
  });

  it('names an unknown source language from the locale', async () => {
    setup({ ok: true, status: 200, data: { translatedText: 'Hallo' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '‹action.translate›' })); });
    expect(barText()).toContain('‹done› ‹source_auto› DE');
  });
});
