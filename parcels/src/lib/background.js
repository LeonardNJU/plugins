// What the plugin decides without a window of its own.

import { detectParcels } from './detect.js';

/** email-banner shouldShow: only messages with a tracking number get a card. */
export function bannerShouldShow(context) {
  const email = context?.email;
  if (!email) return false;
  try {
    return detectParcels(email).length > 0;
  } catch {
    return false;
  }
}
