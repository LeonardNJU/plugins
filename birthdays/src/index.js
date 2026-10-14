// Birthday reminders for Bulwark Mail.
//
// The logic lives in plain modules under ./lib (unit-tested without the
// host); this file only wires it to the plugin api. The bundle runs twice:
// in the hidden background iframe (hooks, activate) and in the sidebar
// widget's iframe (slots). Both get the same api from '@plugin-host'.

const React = require('react');
const api = require('@plugin-host');

import { createBackground } from './lib/background.js';
import { makeWidget } from './lib/widget.js';

const background = createBackground(api);
const BirthdayWidget = makeWidget(React, api);

export const hooks = background.hooks;

export function activate() {
  background.activate();
}

export const slots = {
  'sidebar-widget': {
    component: BirthdayWidget,
    order: 50,
  },
};
