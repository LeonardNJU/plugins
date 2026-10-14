// PostNL: domestic "3S" barcodes (3S + four letters + digits) and UPU S10
// with country NL.
import { s10Check } from '../checkdigits.js';

export default {
  id: 'postnl',
  name: 'PostNL',
  keywords: /\bPostNL\b/i,
  formats: [
    { re: /\b3S[A-Z]{4}\d{6,11}\b/g, strength: 'strong' },
    { re: /\b[A-Z]{2}\d{9}NL\b/g, strength: 'strong', check: s10Check },
  ],
  trackingUrl: (n) => `https://jouw.postnl.nl/track-and-trace/${encodeURIComponent(n)}`,
};
