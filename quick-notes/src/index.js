/**
 * Quick Notes Plugin — per-email sticky notes.
 *
 * Drawn with the app's UI kit: the banner is a one-line reader info bar, the
 * panel beside the open message holds the note in the kit's textarea. It reads notes via
 * api.storage.get('notes') on mount (and whenever the open email changes),
 * and persists edits via api.storage.set('notes', {...}) with a debounce.
 * The background `onEmailOpen` hook refreshes its own in-memory cache so the
 * email-banner shouldShow gate stays accurate.
 */

const React = require('react');
const slotApi = require('@plugin-host');

import { makeNoteBanner, makeNotesPanel } from './lib/notes.js';

let pluginApi = null;
let notes = {}; // emailId → { text, updatedAt }

// ─── Slot components (src/lib/notes.js) ─────────────────────

const NoteBanner = makeNoteBanner(React, slotApi);
const NotesSidebar = makeNotesPanel(React, slotApi);

// shouldShow runs in the background iframe.
function shouldShowBanner(extraProps) {
  if (!pluginApi) return false;
  if (pluginApi.plugin.settings.showBanner === false) return false;
  const email = extraProps?.email;
  if (!email?.id) return false;
  return !!notes[email.id];
}

export const slots = {
  'email-banner': {
    component: NoteBanner,
    shouldShow: shouldShowBanner,
    order: 80,
  },
  'email-detail-sidebar': {
    component: NotesSidebar,
    order: 20,
  },
};

// ─── Hooks ──────────────────────────────────────────────────

export const hooks = {
  // Refresh the in-memory cache when an email is opened so the banner gate
  // is accurate even after edits from the sidebar slot.
  async onEmailOpen() {
    if (!pluginApi) return;
    const stored = await pluginApi.storage.get('notes');
    notes = (stored && typeof stored === 'object') ? stored : {};
  },
};

// ─── Activate ───────────────────────────────────────────────

export async function activate(api) {
  pluginApi = api;
  const stored = await api.storage.get('notes');
  notes = (stored && typeof stored === 'object') ? stored : {};
  api.log.info(`Quick Notes plugin activated (${Object.keys(notes).length} note(s) stored)`);
}
