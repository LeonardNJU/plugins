import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { greetingFor, recipient, sendGreeting } from '../src/lib/greeting.js';
import { createBackground } from '../src/lib/background.js';
import { tagFor } from '../src/lib/reminders.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const ada = { key: 'ada', name: 'Ada Lovelace', firstName: 'Ada', email: 'ada@example.org', year: 1990, month: 10, day: 14 };

describe('greeting', () => {
  it('addresses the contact by first name', () => {
    const api = fakeApi({ translations: manifest.locales });
    expect(greetingFor(ada, api.i18n)).toEqual({
      to: ['"Ada Lovelace" <ada@example.org>'],
      subject: 'Happy birthday, Ada!',
      body: 'Hi Ada,\n\nhappy birthday! All the best for the year ahead.\n\n',
    });
  });

  it('speaks the user language and copes without a name', () => {
    const api = fakeApi({ locale: 'de', translations: manifest.locales });
    const g = greetingFor({ ...ada, name: 'ada@example.org', firstName: '' }, api.i18n);
    expect(g.to).toEqual(['ada@example.org']);
    expect(g.subject).toBe('Alles Gute zum Geburtstag!');
  });

  it('has nothing to send without an address', () => {
    expect(greetingFor({ ...ada, email: null }, fakeApi().i18n)).toBeNull();
  });

  it('keeps names the host would refuse out of the address', () => {
    expect(recipient('Bob "the <Builder>"', 'bob@x.org')).toBe('"Bob the Builder" <bob@x.org>');
  });

  it('opens the composer, and says so in plain words when the host refuses', async () => {
    const ok = fakeApi({ translations: manifest.locales });
    expect(await sendGreeting(ok, ada)).toBe(true);
    expect(ok.calls('compose.open')[0].args[0].subject).toBe('Happy birthday, Ada!');

    const limited = fakeApi({
      translations: manifest.locales,
      handlers: { 'compose.open': async () => { throw new Error('compose.open: at most 5 times a minute'); } },
    });
    expect(await sendGreeting(limited, ada)).toBe(false);
    expect(limited.calls('toast.error')[0].args[0]).toBe('Too many requests in a short time. Wait a minute and try again.');
  });
});

describe('clicking a reminder', () => {
  const contacts = [
    { id: 'c1', name: { full: 'Ada Lovelace' }, emails: { e: { address: 'ada@example.org' } }, anniversaries: { a: { kind: 'birth', date: '--10-14' } } },
    { id: 'c2', name: { full: 'No Mail' }, anniversaries: { a: { kind: 'birth', date: '--10-14' } } },
  ];
  const setup = () => {
    const api = fakeApi({ translations: manifest.locales, handlers: { 'contacts.list': async () => contacts } });
    return { api, bg: createBackground(api, { now: () => new Date(2026, 9, 14, 9) }) };
  };

  it('opens a greeting to that contact', async () => {
    const { api, bg } = setup();
    await bg.hooks.onNotificationClick({ tag: tagFor('c1') });
    expect(api.calls('compose.open').map((c) => c.args[0].to)).toEqual([['"Ada Lovelace" <ada@example.org>']]);
  });

  it('does nothing for summaries, contacts without an address and other tags', async () => {
    const { api, bg } = setup();
    await bg.run();
    for (const tag of ['bday-today', tagFor('c2'), 'other', tagFor('gone')]) await bg.hooks.onNotificationClick({ tag });
    await bg.hooks.onNotificationClick(undefined);
    expect(api.calls('compose.open')).toEqual([]);
  });

  it('ignores clicks on the app’s own notifications without reading the contacts', async () => {
    const { api, bg } = setup();
    await bg.hooks.onNotificationClick({ tag: 'new-mail:123' });
    await bg.hooks.onNotificationClick({ tag: '' });
    expect(api.calls('contacts.list')).toEqual([]);
  });
});
