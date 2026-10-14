// FedEx. 12-digit Express numbers carry a mod 11 check digit, 15-digit
// Ground numbers a GS1 mod 10 one.
import { fedex12Check, gs1Mod10 } from '../checkdigits.js';

export default {
  id: 'fedex',
  name: 'FedEx',
  keywords: /\bFed ?Ex\b/i,
  formats: [
    { re: /\b\d{12}\b/g, strength: 'weak', check: fedex12Check },
    { re: /\b\d{15}\b/g, strength: 'weak', check: gs1Mod10 },
  ],
  trackingUrl: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
};
