import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const source = readdirSync(new URL('../src/', import.meta.url), { recursive: true })
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(new URL(`../src/${f.replaceAll('\\', '/')}`, import.meta.url), 'utf8'))
  .join('\n');

const WEBMAIL_LOCALES = ['ar', 'ca', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hu', 'it', 'ja', 'ko', 'lv', 'mn',
  'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'uk', 'zh', 'zh-TW'];

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  const en = manifest.locales.en;
  // Plural forms other than "other" exist only where a language needs them.
  const required = Object.keys(en).filter((k) => !/^age\.(zero|one|two|few|many)$/.test(k));

  it('cover every webmail language', () => {
    expect(Object.keys(manifest.locales).sort()).toEqual([...WEBMAIL_LOCALES].sort());
  });

  it.each(WEBMAIL_LOCALES)('%s has every string with the same placeholders', (locale) => {
    const table = manifest.locales[locale];
    for (const key of required) {
      expect(table[key], `${locale}: ${key}`).toBeTruthy();
      expect(placeholders(table[key]), `${locale}: ${key}`).toEqual(placeholders(en[key]));
    }
    for (const key of Object.keys(table)) {
      if (key.startsWith('age.')) expect(placeholders(table[key])).toEqual(['age']);
      else expect(en[key], `${locale}: ${key} is not an English key`).toBeTruthy();
    }
  });

  it('has no \\u escapes in the manifest', () => {
    expect(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).not.toMatch(/\\u[0-9a-f]{4}/i);
  });

  it('has every key the code uses', () => {
    const used = new Set([...source.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]));
    for (const key of used) expect(en[key], key).toBeTruthy();
  });
});
