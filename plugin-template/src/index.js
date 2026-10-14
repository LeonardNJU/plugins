/**
 * Bulwark Mail Plugin Template — sandboxed contract.
 *
 * Plugins export three top-level fields:
 *
 *   slots:    { [SlotName]: { component, shouldShow?, order? } }
 *             React components rendered inside their own opaque-origin
 *             iframe. Each slot needs its ui:* permission in the manifest,
 *             or the host does not render it. The component receives the
 *             props of the spot it sits in. The slot iframe has the same
 *             `api` as the background iframe: get it with
 *             `require('@plugin-host')`.
 *
 *   hooks:    { [HookName]: handler }
 *             Handlers dispatched into the background iframe via
 *             postMessage RPC. Handlers may return a Promise. NO DOM
 *             access from hooks — the background iframe is hidden. Each
 *             hook needs a permission (onEmailOpen needs email:read).
 *             onAction receives clicks on the buttons and menu entries
 *             declared with api.ui.setActions.
 *
 *   activate(api): one-shot side effects (storage init, actions, titles).
 *             Runs once in the background iframe.
 *
 * Drawing UI:
 *   - Use the app's UI kit, `@plugin-host/ui` (src/lib/ui.js shows how).
 *     The kit components are the app's own buttons, inputs, rows and bars,
 *     themed like the rest of the app. The iframe has no other CSS, so
 *     no Tailwind classes, no own stylesheets and no hard-coded colours.
 *   - Buttons and menu entries on the app's surfaces (top bar, message
 *     toolbar, composer, command palette) are host-drawn: declare them with
 *     api.ui.setActions(surface, [...]) instead of drawing them yourself.
 *   - Dialogs: api.ui.openDialog({ title, slot: 'plugin-dialog' }). Put the
 *     buttons in the host's footer with <DialogButtons>.
 *
 * Async API surface:
 *   - api.storage.get/set/remove/keys     → returns a Promise
 *   - api.http.post/fetch                  → returns a Promise
 *   - api.ui.confirm/alert/openDialog/openExternalUrl/setActions → Promise
 *   - api.toast.success/info/warning/error → fire-and-forget
 *   - api.log.*                             → local console
 *   - api.plugin.settings                   → current settings, with the
 *     manifest's settingsSchema defaults filled in. Slots re-render when
 *     they change; elsewhere use api.plugin.onSettingsChange(cb).
 *   - api.i18n.t(key, vars) / has(key)      → strings from manifest.locales.
 *     t() returns the key itself when it is missing.
 *
 * IMPORTANT:
 *   - Use `require('react')`; React and the UI kit are provided by the host
 *     and left out of the bundle.
 *   - The slot iframes and the background iframe are separate. State you
 *     mutate in one is not visible in the other; share it through
 *     api.storage.
 */

const React = require('react');
const api = require('@plugin-host');

import { addItem, askForItem, makeDialog, makeSection } from './lib/ui.js';

// ─── Slots ──────────────────────────────────────────────────

export const slots = {
  // A section in the mail sidebar, below the folders (ui:sidebar-widget).
  'sidebar-section': {
    component: makeSection(React, api),
    // shouldShow runs in the BACKGROUND iframe. Return false to skip
    // mounting the slot iframe entirely.
    shouldShow: () => api.plugin.settings.enabled !== false,
    order: 100,
  },
  // The body of the dialog api.ui.openDialog opens (ui:observe).
  'plugin-dialog': {
    component: makeDialog(React, api),
  },
};

// ─── Hooks ──────────────────────────────────────────────────

export const hooks = {
  // Needs email:read, declared in manifest.json.
  onEmailOpen(email) {
    if (api.plugin.settings.enabled === false) return;
    api.log.info('Email opened:', email?.subject);
  },

  // A click on an entry declared with api.ui.setActions.
  async onAction({ actionId }) {
    if (actionId !== 'add') return;
    const name = await askForItem(api);
    if (name) {
      await addItem(api, name);
      api.toast.success(api.i18n.t('toast.added', { name }));
    }
  },

  // Intercept hooks may return a Promise. Return `false` to cancel.
  // onBeforeEmailSend needs email:send.
  // async onBeforeEmailSend(draft) {
  //   const ok = await api.ui.confirm({ title: 'Send?', message: '...' });
  //   return ok ? undefined : false;
  // },
};

// ─── Activate (one-shot init) ───────────────────────────────

// The sidebar section's header and the command palette entry are drawn by
// the host. Without a title the header shows the plugin's name. Both are
// set again when the user switches language or changes the settings.
async function publish(pluginApi) {
  const t = (key) => pluginApi.i18n.t(key);
  const custom = String(pluginApi.plugin.settings.sectionTitle || '').trim();
  await pluginApi.ui.setSectionTitle((custom || t('section.title')).slice(0, 40));
  // A command palette (Ctrl+K) entry, needs ui:commands.
  await pluginApi.ui.setActions('command-palette', [{ id: 'add', label: t('action.add'), icon: 'plus' }]);
}

export async function activate(pluginApi) {
  if (pluginApi.plugin.settings.enabled === false) {
    pluginApi.log.info('Plugin disabled by user settings');
    return;
  }
  await publish(pluginApi);
  pluginApi.i18n.onLocaleChange(() => { void publish(pluginApi); });
  pluginApi.plugin.onSettingsChange(() => { void publish(pluginApi); });
}
