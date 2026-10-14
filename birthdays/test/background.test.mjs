import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { CHANGE_DELAY_MS, SENT_KEY, createBackground } from '../src/lib/background.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const person = (id, name, date, email) => ({
  id, kind: 'individual', addressBookIds: { b: true }, name: { full: name },
  ...(email ? { emails: { e: { address: email } } } : {}),
  anniversaries: { a: { kind: 'birth', date } },
});

function setup({ contacts = [], settings = {}, clock = { now: new Date(2026, 9, 14, 9, 0) }, handlers = {} } = {}) {
  const state = { contacts };
  const api = fakeApi({
    settings: { notify: true, daysBefore: 3, ...settings },
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => {
        if (state.fail) throw new Error(state.fail);
        return state.contacts;
      },
      'notifications.show': async () => 'toast',
      ...handlers,
    },
  });
  const bg = createBackground(api, { now: () => clock.now });
  return { api, bg, state, clock };
}

const shown = (api) => api.calls('notifications.show').map((c) => c.args[0].title);

describe('background reminders', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('reminds of birthdays when the app starts, once', async () => {
    const { api, bg } = setup({ contacts: [person('1', 'Ada', { month: 10, day: 14 }), person('2', 'Ben', { month: 10, day: 16 })] });
    await bg.hooks.onAppReady({ accountId: 'a' });
    expect(shown(api)).toEqual(['It’s Ada’s birthday today', 'Ben’s birthday is in 2 days']);
    await bg.hooks.onAppReady({ accountId: 'a' });
    await bg.run();
    expect(shown(api)).toHaveLength(2);
    expect(Object.keys(api.storageSnapshot()[SENT_KEY])).toEqual(['1', '2']);
  });

  it('remembers across a reload (a new background with the same storage)', async () => {
    const first = setup({ contacts: [person('1', 'Ada', { month: 10, day: 14 })] });
    await first.bg.run();
    const second = createBackground(first.api, { now: () => new Date(2026, 9, 14, 18, 0) });
    await second.run();
    expect(shown(first.api)).toHaveLength(1);
  });

  it('checks again when the day changes and after an hour, not every minute', async () => {
    const { api, bg, clock } = setup({ contacts: [person('1', 'Ada', { month: 10, day: 15 })], settings: { daysBefore: 0 } });
    await bg.hooks.onAppReady({});
    expect(api.calls('contacts.list')).toHaveLength(1);
    clock.now = new Date(2026, 9, 14, 9, 30);
    await bg.hooks.onInterval({});
    expect(api.calls('contacts.list')).toHaveLength(1);
    clock.now = new Date(2026, 9, 14, 10, 0);
    await bg.hooks.onInterval({});
    expect(api.calls('contacts.list')).toHaveLength(2);
    clock.now = new Date(2026, 9, 15, 0, 1);
    await bg.hooks.onInterval({});
    expect(shown(api)).toEqual(['It’s Ada’s birthday today']);
  });

  it.each(['onAfterContactCreate', 'onAfterContactUpdate', 'onAfterContactDelete', 'onContactsImport'])(
    'reads the contacts again shortly after %s',
    async (hook) => {
      const { api, bg, state } = setup();
      await bg.run();
      state.contacts = [person('9', 'New', { month: 10, day: 14 })];
      bg.hooks[hook]({});
      bg.hooks[hook]({});
      await vi.advanceTimersByTimeAsync(CHANGE_DELAY_MS);
      expect(api.calls('contacts.list')).toHaveLength(2);
      expect(shown(api)).toEqual(['It’s New’s birthday today']);
    },
  );

  it('forgets a deleted contact', async () => {
    const { api, bg, state } = setup({ contacts: [person('1', 'Ada', { month: 10, day: 14 })] });
    await bg.run();
    state.contacts = [];
    await bg.run();
    expect(api.storageSnapshot()[SENT_KEY]).toEqual({});
  });

  it('respects the reminder setting', async () => {
    const { api, bg } = setup({ contacts: [person('1', 'Ada', { month: 10, day: 14 })], settings: { notify: false } });
    await bg.run();
    expect(shown(api)).toEqual([]);
  });

  it('stays quiet and tries again later when contacts cannot be read', async () => {
    const { api, bg, state } = setup({ contacts: [person('1', 'Ada', { month: 10, day: 14 })] });
    state.fail = 'contact.list: no active session';
    await bg.hooks.onAppReady({});
    expect(shown(api)).toEqual([]);
    state.fail = null;
    await bg.hooks.onInterval({});
    expect(shown(api)).toEqual(['It’s Ada’s birthday today']);
  });

  it('keeps going when the host refuses a notification', async () => {
    const { api, bg } = setup({
      contacts: [person('1', 'Ada', { month: 10, day: 14 }), person('2', 'Ben', { month: 10, day: 14 })],
      handlers: { 'notifications.show': async () => { throw new Error('notifications.show: at most 5 notifications a minute'); } },
    });
    await bg.run();
    expect(api.calls('notifications.show')).toHaveLength(2);
  });

  it('runs one check at a time', async () => {
    const { api, bg } = setup({ contacts: [person('1', 'Ada', { month: 10, day: 14 })] });
    await Promise.all([bg.run(), bg.run(), bg.run()]);
    expect(api.calls('contacts.list').length).toBeLessThanOrEqual(2);
    expect(shown(api)).toHaveLength(1);
  });
});
