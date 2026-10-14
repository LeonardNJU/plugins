// The background part: reads the contacts when the app starts, once a day
// and an hour after the last check (contacts change on other devices too),
// and soon after the user changes a contact here. Each run sends the
// reminders that are due. A click on a reminder opens a greeting.

import { birthdaysFromContacts } from './contacts.js';
import { localToday } from './dates.js';
import { greetingFor, sendGreeting } from './greeting.js';
import { birthdayForTag, dueReminders, markSent, notificationsFor } from './reminders.js';
import { readSettings } from './settings.js';

/** Storage key of the record of sent reminders. */
export const SENT_KEY = 'sent';
/** Contacts are read again after this long even when nothing happened. */
export const RECHECK_MS = 60 * 60 * 1000;
/** Wait after a contact change, so an import of many runs once. */
export const CHANGE_DELAY_MS = 3000;

export function createBackground(api, { now = () => new Date() } = {}) {
  let birthdays = [];
  let lastDay = null;
  let lastRunAt = 0;
  let running = null;
  let again = false;
  let timer = null;

  async function remind(today) {
    const settings = readSettings(api.plugin.settings);
    const sent = (await api.storage.get(SENT_KEY)) ?? {};
    const due = dueReminders(birthdays, today, settings, sent);
    // Recorded before they are shown: a second open tab reads the record
    // and stays quiet.
    await api.storage.set(SENT_KEY, markSent(sent, due, today, birthdays));
    for (const notification of notificationsFor(due, api.i18n)) {
      try {
        await api.notifications.show(notification);
      } catch (err) {
        api.log.warn('could not show a reminder', err);
      }
    }
  }

  async function check() {
    const today = localToday(now());
    try {
      birthdays = birthdaysFromContacts(await api.contacts.list());
    } catch (err) {
      // No session yet, or the server is away: try again on the next tick.
      api.log.warn('could not read the contacts', err);
      return;
    }
    lastDay = today;
    lastRunAt = now().getTime();
    await remind(today);
  }

  /** One check at a time; a request during a check runs one more after it. */
  async function run() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await check();
        } catch (err) {
          api.log.error('birthday check failed', err);
        }
      } while (again);
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  }

  function runSoon() {
    clearTimeout(timer);
    timer = setTimeout(() => { void run(); }, CHANGE_DELAY_MS);
  }

  const hooks = {
    onAppReady: () => run(),
    onInterval: () => {
      const stale = localToday(now()) !== lastDay || now().getTime() - lastRunAt >= RECHECK_MS;
      return stale ? run() : undefined;
    },
    onAfterContactCreate: runSoon,
    onAfterContactUpdate: runSoon,
    onAfterContactDelete: runSoon,
    onContactsImport: runSoon,
    // A click on a reminder for one contact opens a greeting to them.
    onNotificationClick: async ({ tag } = {}) => {
      if (typeof tag !== 'string' || !tag.startsWith('bday:')) return;
      if (!birthdays.length) await run();
      const birthday = birthdayForTag(birthdays, tag);
      if (birthday && greetingFor(birthday, api.i18n)) await sendGreeting(api, birthday);
    },
  };

  return {
    hooks,
    activate() {
      // Not awaited: the host waits for activate before it registers the
      // plugin, and reading the contacts can take a while.
      void run();
    },
    run,
    get birthdays() { return birthdays; },
  };
}
