import { describe, it, expect } from 'vitest';
import manifest from '../manifest.json' with { type: 'json' };

const WEBMAIL_LOCALES = 'ar ca cs da de en es fa fr he hu it ja ko lv mn nb nl pl pt ro ru sk tr uk zh zh-TW'.split(' ');
const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('translations', () => {
  const en = manifest.locales.en;

  it('cover every webmail language', () => {
    expect(Object.keys(manifest.locales).sort()).toEqual([...WEBMAIL_LOCALES].sort());
  });

  for (const locale of WEBMAIL_LOCALES.filter((l) => l !== 'en')) {
    it(`${locale} has every string with the same placeholders`, () => {
      const table = manifest.locales[locale];
      for (const [key, text] of Object.entries(en)) {
        expect(typeof table[key], `${locale} ${key}`).toBe('string');
        expect(placeholders(table[key]), `${locale} ${key}`).toEqual(placeholders(text));
      }
      expect(Object.keys(table).filter((k) => !(k in en))).toEqual([]);
    });
  }
});
