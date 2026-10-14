// Paperless-ngx for Bulwark: send attachments and messages to Paperless,
// find documents there and attach them to new mail.

import { setApi } from './ui/host.js';
import { Settings } from './ui/Settings.jsx';

export async function activate(api) {
  setApi(api);
}

export const slots = {
  'settings-section': { component: Settings },
};
