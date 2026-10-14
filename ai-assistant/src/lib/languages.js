// Languages offered for translation: the webmail's own languages and a
// few more that are common in mail.

export const TRANSLATION_LANGUAGES = [
  'ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hr', 'hu',
  'it', 'ja', 'ko', 'lv', 'mn', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'tr', 'uk', 'zh', 'zh-TW',
];

/** [{ tag, label }] in the user's language, sorted by label. */
export function languageOptions(uiLocale = 'en') {
  let names = null;
  try {
    names = new Intl.DisplayNames([uiLocale, 'en'], { type: 'language' });
  } catch { /* old runtime */ }
  const collator = new Intl.Collator(uiLocale);
  return TRANSLATION_LANGUAGES
    .map((tag) => ({ tag, label: names?.of(tag) ?? tag }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

/** The language to suggest: the last one used, else English, else German for English users. */
export function defaultTarget(uiLocale = 'en', last) {
  if (last && TRANSLATION_LANGUAGES.includes(last)) return last;
  return uiLocale.split('-')[0] === 'en' ? 'de' : 'en';
}
