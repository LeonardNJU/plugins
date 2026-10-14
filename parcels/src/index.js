// Package tracking: finds tracking numbers in mail, shows their live status
// in the reader, lists parcels on their way in the sidebar and notifies when
// a status changes. Logic lives in ./lib (plain modules, unit-tested); this
// file wires it to the host.

import host from '@plugin-host';
import { bannerShouldShow, createBackground } from './lib/background.js';
import { ParcelCard } from './ui/card.js';
import { DeliveriesWidget } from './ui/widget.js';

let background = null;
const bg = () => (background ??= createBackground(host));

export default {
  slots: {
    'email-banner': { component: ParcelCard, shouldShow: bannerShouldShow },
    'sidebar-widget': { component: DeliveriesWidget, order: 60 },
  },
  hooks: {
    // Once a minute; each parcel is asked about at most every 30 minutes.
    onInterval: () => bg().tick(),
    onNewEmailReceived: (summary) => bg().onNewEmail(summary).then(() => undefined),
  },
  activate() {
    // A first round shortly after start, so parcels don't wait a minute.
    setTimeout(() => { void bg().tick(); }, 5_000);
  },
};
