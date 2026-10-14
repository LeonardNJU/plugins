// Time zone helper: the user's favourite zones and the zones of people they
// write to, shown where times matter.

import { getApi } from './host.js';
import { loadAddressZones } from './lib/address-zones.js';
import { eventZones, outsideHoursWarning } from './lib/event.js';
import { senderTime, worthShowing } from './lib/sender.js';
import { mirrorSettings, readSettings } from './lib/settings.js';
import { ComposeDialog, INSERT_ACTION, OPTIONS_SURFACE, composerActions, openComposeDialog } from './ui/compose-time.jsx';
import { EventZones } from './ui/event-zones.jsx';
import { SenderBanner, SenderDetails } from './ui/sender-time.jsx';
import { WorldClock } from './ui/world-clock.jsx';
import { SettingsSection } from './ui/settings-section.jsx';

const ALWAYS = {
  'settings-section': { component: SettingsSection },
  'calendar-event-form': { component: EventZones },
  'email-banner': {
    component: SenderBanner,
    // Only when the sender's clock differed from yours, or a zone other
    // than yours is saved for them (the bar then says the time there now).
    shouldShow: (ctx) => {
      const api = getApi();
      const home = readSettings(api?.plugin?.settings ?? {}).home;
      return worthShowing(senderTime(ctx?.email, { home }), home);
    },
  },
  'plugin-dialog': { component: ComposeDialog },
  'email-details-section': {
    component: SenderDetails,
    // One row under "Recipients & routing", where the Sent date is.
    shouldShow: (ctx) => ctx?.category === 'recipients_routing' && !!senderTime(ctx?.email, {}),
  },
};

/**
 * The slots to offer. The world clock is off by default, and a sidebar
 * section always shows its header, so it is only offered when the setting
 * is on (read when the plugin starts; the setting says to reload the page).
 */
export function slotsFor(settings) {
  return settings.worldClock ? { ...ALWAYS, 'sidebar-section': { component: WorldClock } } : { ...ALWAYS };
}

export const slots = slotsFor(readSettings(getApi()?.plugin?.settings ?? {}));

export const hooks = {
  /** The Options menu entry: the dialog, which inserts into that composer. */
  onAction({ surface, actionId, context } = {}) {
    const api = getApi();
    if (!api || surface !== OPTIONS_SURFACE || actionId !== INSERT_ACTION) return;
    const composerId = context?.composerId;
    if (typeof composerId !== 'string' || !composerId) return;
    // Not awaited: the host times hooks out, the dialog stays open longer.
    void Promise.resolve(openComposeDialog(api, composerId)).catch(() => {});
  },

  /** Adds "Outside 08:00–20:00 for …" to the event form's warnings. */
  async onCheckEventConflicts(warnings, context) {
    const api = getApi();
    const list = Array.isArray(warnings) ? warnings : [];
    if (!api) return list;
    const settings = readSettings(api.plugin.settings);
    const info = eventZones(context?.event, settings, await loadAddressZones(api.storage));
    const warning = outsideHoursWarning(info, settings, api.i18n.t, api.i18n.getLocale());
    return warning ? [...list, warning] : list;
  },
};

async function registerActions(api) {
  await api.ui.setActions(OPTIONS_SURFACE, composerActions());
  // The world clock's sidebar section; the host draws its header like Folders and Tags.
  await api.ui.setSectionTitle?.(api.i18n.t('clock.heading'));
}

export function activate(api) {
  mirrorSettings(api);
  const register = () => registerActions(api).catch((err) => api.log?.warn?.('setActions failed', err));
  void register();
  api.i18n.onLocaleChange?.(() => { void register(); });
}

export default { slots, hooks, activate };
