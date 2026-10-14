// USPS. Intelligent Mail package barcodes (20-22 digits starting 91-95,
// sometimes behind a "420" + ZIP routing prefix) carry a GS1 mod 10 check
// digit; international mail uses UPU S10 with country US.
import { gs1Mod10, s10Check } from '../checkdigits.js';

export default {
  id: 'usps',
  name: 'USPS',
  keywords: /\bUSPS\b|Postal Service/i,
  formats: [
    { re: /\b9[1-5]\d{18,20}\b/g, strength: 'medium', check: gs1Mod10 },
    { re: /\b420\d{5}9[1-5]\d{18,20}\b/g, strength: 'medium', normalize: (s) => s.slice(8), check: gs1Mod10 },
    { re: /\b[A-Z]{2}\d{9}US\b/g, strength: 'strong', check: s10Check },
  ],
  trackingUrl: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
};
