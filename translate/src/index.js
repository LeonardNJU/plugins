/**
 * Translate Plugin — translate received emails via the host's /api/translate
 * proxy.
 *
 * v2 status: improved. Slot iframes now have full api access, so:
 *   - Settings (targetLanguage, provider, maxChars, autoTranslateForeign)
 *     are read via api.plugin.settings — no more baked-in defaults.
 *   - Translation requests go through api.http.post('/api/translate', body),
 *     which routes via the host with proper Authorization / X-JMAP-Username
 *     headers (the v1 null-origin fetch lost cookies and broke against the
 *     auth check).
 *   - autoTranslateForeign fires once per email when the banner mounts.
 *
 * Caveat: api.email.getBody is still not available, so the slot translates
 * whichever plain-text body is reachable via props.email (preview / text).
 *
 * Deployment note: the host route at /app/api/translate must exist for the
 * underlying request to succeed. The plugin shows a graceful error inline
 * when the endpoint is missing.
 *
 * The bar is drawn with the app's UI kit: an InfoBar like the app's own
 * "External content" bar, with bar buttons.
 */

const React = require('react');
const slotApi = require('@plugin-host');

import { makeTranslateBanner } from './lib/banner.js';

// The bar itself lives in src/lib/banner.js (the kit's reader InfoBar).
const TranslateBanner = makeTranslateBanner(React, slotApi);

export const slots = {
  'email-banner': {
    component: TranslateBanner,
    shouldShow: () => true,
    order: 90,
  },
};

export async function activate(api) {
  api.log.info('Translate plugin activated');
}
