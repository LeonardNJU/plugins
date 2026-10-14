// DHL (DHL Paket, Deutsche Post, DHL Express, DHL eCommerce).
import { gs1Mod10, mod7Check, s10Check } from '../checkdigits.js';

const nospace = (s) => s.replace(/\s+/g, '');

export default {
  id: 'dhl',
  name: 'DHL',
  keywords: /\bDHL\b|Deutsche Post|\bPackstation\b/i,
  // Statuses come from the DHL Unified Tracking API when the admin set it up.
  dhlApi: true,
  formats: [
    // DHL Paket barcode, an SSCC with DHL's GS1 prefix: 20 digits, GS1 check.
    { re: /\b00340\d{15}\b/g, strength: 'strong', check: gs1Mod10 },
    // The same, printed in groups of four.
    { re: /\b0034 0\d{3}(?: \d{4}){3}\b/g, strength: 'strong', check: gs1Mod10, normalize: nospace },
    // International DHL Paket ("JJD" + 18 digits); no public check digit.
    { re: /\bJJD\d{18}\b/g, strength: 'strong' },
    // DHL Parcel UK / Express "JD" + 18 digits.
    { re: /\bJD\d{18}\b/g, strength: 'medium' },
    // DHL eCommerce "GM" + 16-18 digits.
    { re: /\bGM\d{16,18}\b/g, strength: 'medium' },
    // Deutsche Post / DHL registered mail (UPU S10, country DE).
    { re: /\b[A-Z]{2}\d{9}DE\b/g, strength: 'strong', check: s10Check },
    // DHL Express waybill: 10 digits, mod 7.
    { re: /\b\d{10}\b/g, strength: 'weak', check: mod7Check },
    // DHL Paket 12-digit number; no published check digit.
    { re: /\b\d{12}\b/g, strength: 'weak' },
  ],
  trackingUrl: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}&submit=1`,
};
