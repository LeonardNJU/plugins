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

const MB = 1024 * 1024;

/**
 * A file the user attaches in the composer (onBeforeBlobUpload hands over
 * its staged id). From the size in the settings on, offer to upload it to
 * Nextcloud and put a link in the message instead. Returns the composer's
 * ExternalAttachmentResult, or undefined to attach the file as usual.
 */
export async function offerLargeUpload(api, payload) {
  const fileId = typeof payload === 'string' ? payload : payload?.fileId;
  if (typeof fileId !== 'string' || !fileId) return undefined;
  const settings = api.plugin.settings ?? {};
  if (settings.offerLargeUpload === false) return undefined;
  const account = await storedAccount(api);
  if (!account?.connected) return undefined;
  const file = await api.upfiles.get(fileId);
  if (!file) return undefined;
  const threshold = Math.max(1, Number(settings.largeFileMb) || 10) * MB;
  if (file.size < threshold) return undefined;
  const result = await api.ui.openDialog({
    title: api.i18n.t('offload.title'),
    slot: 'plugin-dialog',
    extraProps: { view: 'offload', fileId, name: file.name, size: file.size },
    width: 560,
  });
  if (result && result.externalAttachment === true && typeof result.html === 'string' && typeof result.text === 'string') {
    return { externalAttachment: true, html: result.html, text: result.text, fileId };
  }
  return undefined;
}

export const hooks = {
  onBeforeBlobUpload: (payload) => (bg ? offerLargeUpload(bg, payload) : undefined),
  onTransformOutgoingEmail: (outgoing) => (bg ? addLinksToMessage(bg, outgoing) : undefined),
  // Links picked for a message that was then discarded don't carry over to the next one.
  onComposerClose: () => (bg ? clearPending(bg.storage) : undefined),
};

export const slots = {
  'settings-section': { component: SettingsSection },
  'composer-attachment-source': { component: ComposerSource, order: 50 },
  'plugin-dialog': { component: PluginDialog },
};
