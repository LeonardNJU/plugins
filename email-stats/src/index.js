/**
 * Email Stats Plugin — a sidebar section with lifetime counters.
 *
 *   - The `hooks` export runs inside the BACKGROUND iframe and bumps the
 *     persisted lifetime counters in plugin storage.
 *   - The `slots['sidebar-section']` component (src/lib/widget.js) runs in
 *     its own iframe and reads the same storage. The host draws the section
 *     header with the plugin's name; the plugin draws only the rows.
 *
 * Settings (trackOpens / trackSent) are honoured inside the hook handlers
 * rather than skipping registration, because hook registration is static.
 */

const React = require('react');
const slotApi = require('@plugin-host');

import { makeStatsWidget } from './lib/widget.js';

export const slots = {
  'sidebar-section': {
    component: makeStatsWidget(React, slotApi),
    order: 10,
  },
};

// ─── Hooks (background iframe) ──────────────────────────────

let pluginApi = null;
let lifetime = { opened: 0, sent: 0, received: 0 };

async function bump(field) {
  if (!pluginApi) return;
  lifetime[field]++;
  // Fire-and-forget; serialise to storage but don't block the hook on it.
  void pluginApi.storage.set('lifetime', lifetime);
}

export const hooks = {
  onEmailOpen() {
    if (pluginApi?.plugin.settings.trackOpens === false) return;
    void bump('opened');
  },
  onAfterEmailSend() {
    if (pluginApi?.plugin.settings.trackSent === false) return;
    void bump('sent');
  },
  onNewEmailReceived() {
    void bump('received');
  },
};

// ─── Activate ───────────────────────────────────────────────

export async function activate(api) {
  pluginApi = api;
  const stored = (await api.storage.get('lifetime')) || null;
  if (stored && typeof stored === 'object') {
    lifetime = {
      opened: Number(stored.opened) || 0,
      sent: Number(stored.sent) || 0,
      received: Number(stored.received) || 0,
    };
  }
  api.log.info(
    `Email Stats activated (lifetime: opened=${lifetime.opened} sent=${lifetime.sent} received=${lifetime.received})`,
  );
}
