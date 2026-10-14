import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEBMAIL_LOCALES = ['ar', 'ca', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hu', 'it', 'ja', 'ko', 'lv', 'mn', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'uk', 'zh', 'zh-TW'];
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const en = manifest.locales.en;
const sources = readdirSync(path.join(DIR, 'src'), { recursive: true }).filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(path.join(DIR, 'src', f), 'utf8')).join('\n');

describe('translations', () => {
  it('cover every webmail language', () => {
    expect(Object.keys(manifest.locales).sort()).toEqual([...WEBMAIL_LOCALES].sort());
  });

  it.each(WEBMAIL_LOCALES)('%s has every key, the same placeholders, no \\u escapes', (lang) => {
    const table = manifest.locales[lang];
    expect(Object.keys(table)).toEqual(Object.keys(en));
    for (const [key, text] of Object.entries(en)) {
      const want = (text.match(/\{\w+\}/g) ?? []).sort();
      expect((table[key].match(/\{\w+\}/g) ?? []).sort(), `${lang} ${key}`).toEqual(want);
      expect(table[key].trim(), `${lang} ${key}`).not.toBe('');
    }
    expect(readFileSync(path.join(DIR, 'locales', `${lang}.json`), 'utf8')).not.toMatch(/\\u[0-9a-f]{4}/i);
  });

  it('manifest.json matches locales/*.json', () => {
    for (const lang of WEBMAIL_LOCALES) {
      expect(manifest.locales[lang]).toEqual(JSON.parse(readFileSync(path.join(DIR, 'locales', `${lang}.json`), 'utf8')));
    }
  });

  it('settings labels, help lines and choices are translation keys', () => {
    const keys = [];
    for (const field of Object.values(manifest.settingsSchema)) {
      keys.push(field.label, field.description, ...(field.options ?? []));
    }
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) expect(en[key], key).toBeTypeOf('string');
  });

  it('every key the code uses exists in English', () => {
    const used = new Set();
    for (const m of sources.matchAll(/\bt\(\s*'([a-z_]+\.[a-zA-Z_.]+)'/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(5);
    for (const key of used) expect(en[key], key).toBeTypeOf('string');
  });
});
