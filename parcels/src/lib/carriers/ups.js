// UPS. "1Z" numbers carry a check digit (see upsCheck).
import { upsCheck } from '../checkdigits.js';

export default {
  id: 'ups',
  name: 'UPS',
  // Case-sensitive: "ups" is an English word.
  keywords: /\bUPS\b|ups\.com/,
  formats: [
    { re: /\b1Z[0-9A-Z]{16}\b/g, strength: 'strong', check: upsCheck },
    // Printed with spaces, e.g. "1Z 999 AA1 01 2345 678 4".
    { re: /\b1Z(?: ?[0-9A-Z]){16}\b/g, strength: 'strong', check: upsCheck, normalize: (s) => s.replace(/\s+/g, '') },
  ],
  trackingUrl: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
};
