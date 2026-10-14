import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUSES } from '../src/lib/status.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(path.join(here, '../manifest.json'), 'utf8');
const manifest = JSON.parse(raw);
const WEBMAIL_LOCALES = ['ar', 'ca', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hu', 'it', 'ja', 'ko', 'lv', 'mn', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'uk', 'zh', 'zh-TW'];
const en = manifest.locales.en;
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory()
    ? sourceFiles(path.join(dir, d.name))
    : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
}

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
    for (const file of sourceFiles(path.join(here, '../src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z]+\.[a-zA-Z_]+)'/g)) used.add(m[1]);
    }
    for (const s of STATUSES) used.add(`status.${s}`);
    for (const c of ['not_configured', 'auth', 'rate_limit', 'quota', 'timeout', 'unreachable', 'blocked', 'unknown_number', 'service']) used.add(`error.${c}`);
    expect(used.size).toBeGreaterThan(30);
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
