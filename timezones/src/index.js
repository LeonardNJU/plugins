// Time zone helper: the user's favourite zones and the zones of people they
// write to, shown where times matter.

import { mirrorSettings } from './lib/settings.js';
import { SettingsSection } from './ui/settings-section.jsx';

export const slots = {
  'settings-section': { component: SettingsSection },
};

export function activate(api) {
  mirrorSettings(api);
}

export default { slots, activate };
