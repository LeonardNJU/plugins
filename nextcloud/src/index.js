// Nextcloud for Bulwark Mail.
//
// The background part registers actions and hooks; each slot is a React
// component in its own iframe. Every request to Nextcloud goes through the
// webmail's secret proxy with the "nextcloud" credential, so the app
// password never reaches the plugin.

import { setApi } from './lib/host.js';
import { storedAccount } from './lib/connection.js';
import { appendLinks, clearPending, getPending, linkBlock } from './lib/links.js';
import { SettingsSection } from './ui/settings-section.js';
import { ComposerSource } from './ui/composer-source.js';
import { PluginDialog } from './ui/dialog.js';

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

let bg = null;

export async function activate(api) {
  bg = api;
  setApi(api);
  await offerFirstRun(api).catch(() => {});
}

/** Add the share links picked in the composer to the message being sent. */
export async function addLinksToMessage(api, outgoing) {
  const links = await getPending(api.storage);
  if (!links.length) return undefined;
  const next = appendLinks(outgoing, linkBlock(api.i18n.t, links, api.i18n.getLocale()));
  await clearPending(api.storage);
  return next;
}

export const hooks = {
  onTransformOutgoingEmail: (outgoing) => (bg ? addLinksToMessage(bg, outgoing) : undefined),
  // Links picked for a message that was then discarded don't carry over to the next one.
  onComposerClose: () => (bg ? clearPending(bg.storage) : undefined),
};

export const slots = {
  'settings-section': { component: SettingsSection },
  'composer-attachment-source': { component: ComposerSource, order: 50 },
  'plugin-dialog': { component: PluginDialog },
};
