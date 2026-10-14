// Royal Mail: tracked and signed-for items use UPU S10 with country GB.
import { s10Check } from '../checkdigits.js';

export default {
  id: 'royalmail',
  name: 'Royal Mail',
  keywords: /Royal ?Mail/i,
  formats: [
    { re: /\b[A-Z]{2}\d{9}GB\b/g, strength: 'strong', check: s10Check },
  ],
  trackingUrl: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(n)}`,
};
