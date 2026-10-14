// DPD. Parcel numbers are 14 digits starting with the depot number. DPD
// publishes no check digit for the 14-digit form, so these need "DPD" and a
// tracking word around them.
export default {
  id: 'dpd',
  name: 'DPD',
  keywords: /\bDPD\b/i,
  formats: [
    { re: /\b0\d{13}\b/g, strength: 'weak' },
  ],
  trackingUrl: (n) => `https://tracking.dpd.de/status/en_US/parcel/${encodeURIComponent(n)}`,
};
