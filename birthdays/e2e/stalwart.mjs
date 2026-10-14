// Seeding contacts and reading calendar events in the Stalwart test server
// over JMAP, for the end-to-end tests. Same account the webmail signs in to.

import { PASSWORD, USER } from '../../e2e/helpers.mjs';

const JMAP_URL = process.env.STALWART_JMAP_URL || 'http://localhost:18025/jmap/';
const USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:contacts', 'urn:ietf:params:jmap:calendars'];
const auth = 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`).toString('base64');

let session = null;

async function jmap(methodCalls) {
  if (!session) {
    const res = await fetch(new URL('/jmap/session', JMAP_URL), { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`JMAP session: HTTP ${res.status}`);
    const s = await res.json();
    session = { accountId: s.primaryAccounts['urn:ietf:params:jmap:contacts'] };
  }
  const calls = methodCalls.map(([name, args], i) => [name, { accountId: session.accountId, ...args }, String(i)]);
  const res = await fetch(JMAP_URL, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ using: USING, methodCalls: calls }),
  });
  if (!res.ok) throw new Error(`JMAP: HTTP ${res.status} ${await res.text()}`);
  const body = await res.json();
  for (const [name, result] of body.methodResponses) {
    if (name === 'error') throw new Error(`JMAP error: ${JSON.stringify(result)}`);
  }
  return body.methodResponses.map(([, result]) => result);
}

export async function defaultAddressBookId() {
  const [books] = await jmap([['AddressBook/get', {}]]);
  return (books.list.find((b) => b.isDefault) ?? books.list[0]).id;
}

/** Create contacts: [{ name, email?, date: PartialDate }] → their ids, in order. */
export async function createContacts(people) {
  const bookId = await defaultAddressBookId();
  const create = Object.fromEntries(people.map((p, i) => [`c${i}`, {
    '@type': 'Card',
    version: '1.0',
    kind: 'individual',
    addressBookIds: { [bookId]: true },
    name: { full: p.name },
    ...(p.email ? { emails: { e1: { '@type': 'EmailAddress', address: p.email } } } : {}),
    ...(p.date ? { anniversaries: { a1: { '@type': 'Anniversary', kind: 'birth', date: { '@type': 'PartialDate', ...p.date } } } } : {}),
  }]));
  const [result] = await jmap([['ContactCard/set', { create }]]);
  if (result.notCreated && Object.keys(result.notCreated).length) throw new Error(`Contacts not created: ${JSON.stringify(result.notCreated)}`);
  return people.map((_, i) => result.created[`c${i}`].id);
}

export async function updateContact(id, patch) {
  const [result] = await jmap([['ContactCard/set', { update: { [id]: patch } }]]);
  if (result.notUpdated?.[id]) throw new Error(`Contact not updated: ${JSON.stringify(result.notUpdated[id])}`);
}

export async function deleteContacts(ids) {
  if (ids.length) await jmap([['ContactCard/set', { destroy: ids }]]);
}

/** Every calendar event the plugin manages (its marker in the description). */
export async function birthdayEvents() {
  const [, got] = await jmap([
    ['CalendarEvent/query', {}],
    ['CalendarEvent/get', { '#ids': { resultOf: '0', name: 'CalendarEvent/query', path: '/ids' }, properties: ['id', 'title', 'start', 'showWithoutTime', 'description', 'recurrenceRules', 'calendarIds'] }],
  ]);
  return got.list.filter((e) => /\[birthdays:[^\]]+\]/.test(e.description ?? ''));
}

export async function deleteEvents(ids) {
  if (ids.length) await jmap([['CalendarEvent/set', { destroy: ids }]]);
}

/** The contact key in a plugin-made event's description. */
export function eventKey(event) {
  const m = /\[birthdays:([^\]\s]+)\]/.exec(event.description ?? '');
  return m ? decodeURIComponent(m[1]) : null;
}

/** Delete messages (drafts a greeting left behind) whose subject contains `text`. */
export async function deleteMailWithSubject(text) {
  const [query] = await jmap([['Email/query', { filter: { subject: text } }]]);
  if (query.ids.length) await jmap([['Email/set', { destroy: query.ids }]]);
  return query.ids.length;
}
