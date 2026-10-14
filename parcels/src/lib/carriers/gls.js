// GLS. Parcel numbers are 11 or 12 digits; GLS publishes no check digit.
export default {
  id: 'gls',
  name: 'GLS',
  keywords: /\bGLS\b/i,
  formats: [
    { re: /\b\d{11,12}\b/g, strength: 'weak' },
  ],
  trackingUrl: (n) => `https://gls-group.com/GROUP/en/parcel-tracking?match=${encodeURIComponent(n)}`,
};
