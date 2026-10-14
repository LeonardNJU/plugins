// Nextcloud for Bulwark Mail.
//
// The background part registers actions and hooks; each slot is a React
// component in its own iframe. Every request to Nextcloud goes through the
// webmail's secret proxy with the "nextcloud" credential, so the app
// password never reaches the plugin.

import { setApi } from './lib/host.js';
import { storedAccount } from './lib/connection.js';
import { SettingsSection } from './ui/settings-section.js';

const FIRST_RUN_KEY = 'firstRunOffered';

/**
 * Once per account: if Nextcloud isn't connected yet, say where to connect
 * it. People coming from "Nextcloud Attachments" sign in again here; their
 * old app password is not carried over.
 */
export async function offerFirstRun(api) {
  if (await api.storage.get(FIRST_RUN_KEY)) return false;
  const account = await storedAccount(api);
  await api.storage.set(FIRST_RUN_KEY, true);
  if (account?.connected) return false;
  api.toast.info(api.i18n.t('firstrun.offer'));
  return true;
}

export async function activate(api) {
  setApi(api);
  await offerFirstRun(api).catch(() => {});
}

export const hooks = {};

export const slots = {
  'settings-section': { component: SettingsSection },
};
