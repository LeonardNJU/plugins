// AI writing assistant for Bulwark Webmail.
//
// Background: nothing runs until the user clicks one of the assistant's
// buttons. Requests go through the webmail's server proxy, which adds the
// API key the administrator (or the user) set up; the key never reaches
// the browser.

import { SettingsPanel } from './ui/SettingsPanel.jsx';

export default {
  slots: {
    'settings-section': { component: SettingsPanel },
  },
};
