// AI writing assistant for Bulwark Webmail.
//
// Nothing is sent anywhere until the user clicks one of the assistant's
// buttons. Requests go through the webmail's server proxy, which adds the
// API key the administrator (or the user) set up; the key never reaches
// the browser.

import { createBackground } from './lib/background.js';
import { SettingsPanel } from './ui/SettingsPanel.jsx';
import { ComposerButton } from './ui/Composer.jsx';
import { Dialog } from './ui/Dialog.jsx';
import { ReaderBar, ThreadSummary } from './ui/Reader.jsx';

let background = null;
const bg = () => background ?? { shouldShow: { reader: () => false, thread: () => false, composer: () => false }, hooks: {} };

export default {
  async activate(api) {
    background = createBackground(api);
    await background.activate();
  },
  hooks: {
    onDraftChange: (draft) => bg().hooks.onDraftChange?.(draft),
    onComposerOpen: () => bg().hooks.onComposerOpen?.(),
    onComposerClose: () => bg().hooks.onComposerClose?.(),
    onEmailOpen: () => bg().hooks.onEmailOpen?.(),
  },
  slots: {
    'email-banner': { component: ReaderBar, shouldShow: () => bg().shouldShow.reader() },
    'thread-summary': { component: ThreadSummary, shouldShow: (ctx) => bg().shouldShow.thread(ctx) },
    'composer-toolbar': { component: ComposerButton, shouldShow: () => bg().shouldShow.composer() },
    'plugin-dialog': { component: Dialog },
    'settings-section': { component: SettingsPanel },
  },
};
