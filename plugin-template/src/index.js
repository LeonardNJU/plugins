/**
 * Bulwark Mail Plugin Template — sandboxed contract.
 *
 * Plugins export three top-level fields:
 *
 *   slots:    { [SlotName]: { component, shouldShow?, order? } }
 *             React components rendered inside their own opaque-origin
 *             iframe. Each slot needs its ui:* permission in the manifest,
 *             or the host does not render it. The component receives the
 *             props of the spot it sits in; data props (the open email,
 *             the account) are only passed with the matching read
 *             permission, and some slots (sidebar-widget) get none. The
 *             slot iframe has the same `api` as the background iframe
 *             (api.storage, api.http, api.plugin.settings, api.i18n, ...):
 *             get it with `require('@plugin-host')`.
 *
 *   hooks:    { [HookName]: handler }
 *             Handlers dispatched into the background iframe via
 *             postMessage RPC. Handlers may return a Promise. NO DOM
 *             access from hooks — the background iframe is hidden. Each
 *             hook needs a permission (onEmailOpen needs email:read), or
 *             the host does not register it.
 *
 *   activate(api): one-shot side effects (storage init, http calls).
 *             Runs once in the background iframe. Should NOT register
 *             hooks here — use the `hooks` export instead.
 *
 * Async API surface:
 *   - api.storage.get/set/remove/keys     → returns a Promise
 *   - api.http.post/fetch                  → returns a Promise
 *   - api.admin.getConfig/setConfig/etc.   → returns a Promise
 *   - api.ui.confirm/alert/openExternalUrl → returns a Promise
 *   - api.toast.success/info/warning/error → fire-and-forget
 *   - api.log.*                             → local console
 *   - api.plugin.settings                   → current settings, with the
 *     manifest's settingsSchema defaults filled in. Slots re-render when
 *     they change; elsewhere use api.plugin.onSettingsChange(cb).
 *   - api.i18n.t(key, vars) / has(key)      → strings from manifest.locales.
 *     t() returns the key itself when it is missing.
 *
 * IMPORTANT:
 *   - Do NOT import React via globalThis.__PLUGIN_EXTERNALS__ (that hook
 *     is gone). Use `const React = require('react')` instead; the
 *     bundler will mark it external and the host injects React at
 *     evaluation time.
 *   - Hooks are dispose-managed by the host. Don't try to capture
 *     "Disposable" return values — there aren't any.
 *   - The slot iframe and background iframe are separate. State you
 *     mutate in one is not visible in the other; share it through
 *     api.storage.
 */

const { createElement: h, useState } = require('react');
const api = require('@plugin-host');

const t = (key, vars) => api.i18n.t(key, vars);

// ─── Slot component example ─────────────────────────────────

function MyWidget() {
  const [count, setCount] = useState(0);
  const title = String(api.plugin.settings.widgetTitle || '').trim() || t('widget.title');
  return h(
    'div',
    { style: { padding: '12px', fontSize: '13px' } },
    h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, title),
    h(
      'button',
      {
        type: 'button',
        onClick: () => setCount((c) => c + 1),
        style: {
          font: 'inherit',
          padding: '6px 10px',
          borderRadius: '6px',
          border: '1px solid var(--color-input)',
          background: 'var(--color-muted)',
          color: 'var(--color-foreground)',
          cursor: 'pointer',
        },
      },
      t('widget.clicked', { count }),
    ),
  );
}

export const slots = {
  // Pick a slot name from SlotName in lib/plugin-types.ts and add the
  // permission it needs to manifest.json:
  //   toolbar-actions (ui:toolbar), app-top-banner (ui:app-top-banner),
  //   email-banner (ui:email-banner), email-footer (ui:email-footer),
  //   composer-toolbar (ui:composer-toolbar),
  //   composer-sidebar, composer-sidebar-right (ui:composer-sidebar),
  //   sidebar-widget (ui:sidebar-widget),
  //   email-detail-sidebar (ui:email-details),
  //   settings-section (ui:settings-section),
  //   context-menu-email (ui:context-menu),
  //   navigation-rail-bottom (ui:navigation-rail),
  //   calendar-event-actions (ui:calendar-action),
  //   admin-plugin-page (ui:admin-page)
  'sidebar-widget': {
    component: MyWidget,
    // shouldShow runs in the BACKGROUND iframe. Return false to skip
    // mounting the slot iframe entirely.
    shouldShow: () => api.plugin.settings.enabled !== false,
    order: 100,
  },
};

// ─── Hooks ──────────────────────────────────────────────────

export const hooks = {
  onAppReady() {
    api.log.info('App is ready');
  },

  // Needs email:read, declared in manifest.json.
  onEmailOpen(email) {
    if (api.plugin.settings.enabled === false) return;
    api.log.info('Email opened:', email?.subject);
  },

  // Intercept hooks may return a Promise. Return `false` to cancel.
  // onBeforeEmailSend needs email:send.
  // async onBeforeEmailSend(draft) {
  //   const ok = await api.ui.confirm({ title: 'Send?', message: '...' });
  //   return ok ? undefined : false;
  // },
};

// ─── Activate (one-shot init) ───────────────────────────────

export async function activate(api) {
  api.plugin.onSettingsChange((settings) => {
    api.log.info(`Settings changed (enabled: ${settings.enabled !== false})`);
  });

  if (api.plugin.settings.enabled === false) {
    api.log.info('Plugin disabled by user settings');
    return;
  }

  const runCount = Number((await api.storage.get('runCount')) || 0) + 1;
  await api.storage.set('runCount', runCount);
  api.log.info(`Plugin activated (run ${runCount})`);
}
