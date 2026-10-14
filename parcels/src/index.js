// Package tracking: finds tracking numbers in mail and shows their live
// status in the reader. Logic lives in ./lib (plain modules, unit-tested);
// this file wires it to the host.

import { bannerShouldShow } from './lib/background.js';
import { ParcelCard } from './ui/card.js';

export default {
  slots: {
    'email-banner': { component: ParcelCard, shouldShow: bannerShouldShow },
  },
};
