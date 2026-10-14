// "Send greeting": the composer, filled in for one contact. The user
// reads it, changes what they like and sends it themselves.

import { errorText } from './format.js';

/** `"Name" <address>`, with characters the host refuses in a name removed. */
export function recipient(name, email) {
  const clean = String(name ?? '').replace(/["<>\r\n]/g, '').trim();
  return clean && !clean.includes('@') ? `"${clean}" <${email}>` : email;
}

/** What api.compose.open gets for a greeting, or null without an address. */
export function greetingFor(birthday, i18n) {
  if (!birthday?.email) return null;
  const first = birthday.firstName || '';
  return {
    to: [recipient(birthday.name, birthday.email)],
    subject: first ? i18n.t('greeting.subject', { name: first }) : i18n.t('greeting.subjectNoName'),
    body: first ? i18n.t('greeting.body', { name: first }) : i18n.t('greeting.bodyNoName'),
  };
}

/** Open the composer with a greeting; tells the user in plain words when it can't. */
export async function sendGreeting(api, birthday) {
  const message = greetingFor(birthday, api.i18n);
  if (!message) return false;
  try {
    await api.compose.open(message);
    return true;
  } catch (err) {
    api.log.warn('could not open the composer', err);
    api.toast.error(errorText(err, api.i18n));
    return false;
  }
}
