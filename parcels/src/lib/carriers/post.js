// Other national postal services: UPU S10 numbers from countries without a
// carrier module of their own. The country is the last two letters.
import { s10Check } from '../checkdigits.js';

export default {
  id: 'post',
  name: 'Post',
  keywords: /\bpost\b|registered mail|einschreiben|recommand/i,
  formats: [
    { re: /\b[A-Z]{2}\d{9}(?!DE\b|GB\b|US\b|NL\b)[A-Z]{2}\b/g, strength: 'strong', check: s10Check },
  ],
  trackingUrl: (n) => `https://t.17track.net/en#nums=${encodeURIComponent(n)}`,
};
