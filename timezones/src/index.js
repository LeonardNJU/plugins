// Time zone helper: the user's favourite zones and the zones of people they
// write to, shown where times matter.

import { getApi } from './host.js';
import { loadAddressZones } from './lib/address-zones.js';
import { eventZones, outsideHoursWarning } from './lib/event.js';
import { senderTime, worthShowing } from './lib/sender.js';
import { mirrorSettings, readSettings } from './lib/settings.js';
import { ComposeButton, ComposeDialog } from './ui/compose-time.jsx';
import { EventZones } from './ui/event-zones.jsx';
import { SenderDetails, SenderLine } from './ui/sender-time.jsx';
import { SettingsSection } from './ui/settings-section.jsx';

export const slots = {
  'settings-section': { component: SettingsSection },
  'calendar-event-form': { component: EventZones },
  'reader-below-subject': {
    component: SenderLine,
    // Only when the sender's clock differed from yours; the slot itself
    // also shows the time now where a sender with a saved zone is.
    shouldShow: (ctx) => {
      const api = getApi();
      const home = readSettings(api?.plugin?.settings ?? {}).home;
      return worthShowing(senderTime(ctx?.email, { home }), home);
    },
  },
  'composer-toolbar': { component: ComposeButton },
  'plugin-dialog': { component: ComposeDialog },
  'email-details-section': {
    component: SenderDetails,
    // One row under "Recipients & routing", where the Sent date is.
    shouldShow: (ctx) => ctx?.category === 'recipients_routing' && !!senderTime(ctx?.email, {}),
  },
};

export const hooks = {
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

export function activate(api) {
  mirrorSettings(api);
}

export default { slots, hooks, activate };
