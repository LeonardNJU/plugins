// Time zone helper: the user's favourite zones and the zones of people they
// write to, shown where times matter.

import { getApi } from './host.js';
import { loadAddressZones } from './lib/address-zones.js';
import { eventZones, outsideHoursWarning } from './lib/event.js';
import { mirrorSettings, readSettings } from './lib/settings.js';
import { EventZones } from './ui/event-zones.jsx';
import { SettingsSection } from './ui/settings-section.jsx';

export const slots = {
  'settings-section': { component: SettingsSection },
  'calendar-event-form': { component: EventZones },
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
