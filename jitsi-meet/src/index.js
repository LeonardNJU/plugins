/**
 * Jitsi Meet Plugin — adds "Add Jitsi meeting" to calendar events.
 *
 * The calendar-event-actions slot receives `setVirtualLocation` as an RPC
 * callback prop. The button (src/lib/button.js, the app's own outline
 * button from the UI kit) asks the /api/jitsi sidecar for a meeting URL
 * and puts it straight into the event form's meeting link field.
 */

const React = require('react');
const slotApi = require('@plugin-host');

import { makeJitsiButton } from './lib/button.js';

export const slots = {
  'calendar-event-actions': {
    component: makeJitsiButton(React, slotApi),
    order: 10,
  },
};

export async function activate(api) {
  api.log.info('Jitsi Meet plugin activated');
}
