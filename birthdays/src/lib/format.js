// Text for the widget and the reminders. Day names, "tomorrow" and "in 3
// days" come from Intl, so they are right in every language without
// translations of our own; the rest goes through api.i18n.

function safeLocale(locale) {
  try {
    return Intl.getCanonicalLocales(locale)[0] || 'en';
  } catch {
    return 'en';
  }
}

function capitalize(textValue, locale) {
  if (!textValue) return textValue;
  return textValue.charAt(0).toLocaleUpperCase(safeLocale(locale)) + textValue.slice(1);
}

/** "today", "tomorrow", "in 3 days" in the user's language. */
export function relativeDays(days, locale) {
  try {
    return new Intl.RelativeTimeFormat(safeLocale(locale), { numeric: 'auto' }).format(days, 'day');
  } catch {
    return `+${days}`;
  }
}

/** "October 20" (no year) in the user's language. */
export function monthDay(iso, locale) {
  const [y, m, d] = iso.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(safeLocale(locale), { month: 'long', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return iso.slice(5);
  }
}

/**
 * "turns 36", with the plural form of the language (Russian, Polish and
 * others change the word with the number). Keys: `age.one`, `age.few`,
 * `age.many`, `age.two`, `age.zero`, falling back to `age.other`.
 */
export function ageText(age, i18n) {
  const locale = safeLocale(i18n.getLocale ? i18n.getLocale() : 'en');
  let rule = 'other';
  try { rule = new Intl.PluralRules(locale).select(age); } catch { /* keep other */ }
  const key = i18n.has(`age.${rule}`) ? `age.${rule}` : 'age.other';
  return i18n.t(key, { age });
}

/** "Today · October 14 · turns 36" for one upcoming birthday. */
export function whenLine(entry, i18n) {
  const locale = i18n.getLocale ? i18n.getLocale() : 'en';
  const parts = [capitalize(relativeDays(entry.daysUntil, locale), locale), monthDay(entry.date, locale)];
  if (entry.age) parts.push(ageText(entry.age, i18n));
  return parts.join(' · ');
}

/**
 * A plain-words message for a failed host call. The host's own messages are
 * English and technical; the user gets one of ours.
 */
export function errorText(err, i18n) {
  const message = String(err?.message ?? err ?? '').toLowerCase();
  if (message.includes('permission') || message.includes('not granted') || message.includes('forbidden')) {
    return i18n.t('error.permission');
  }
  if (message.includes('timed out') || message.includes('timeout')) return i18n.t('error.timeout');
  if (message.includes('no active session') || message.includes('unauthor') || message.includes('401')) {
    return i18n.t('error.session');
  }
  if (message.includes('a minute')) return i18n.t('error.rate');
  return i18n.t('error.generic');
}
