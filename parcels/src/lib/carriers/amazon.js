// Amazon Logistics: "TBA" (also TBC, TBM) + 12 digits. No check digit.
export default {
  id: 'amazon',
  name: 'Amazon',
  keywords: /\bAmazon\b/i,
  formats: [
    { re: /\bTB[ACM]\d{12}\b/g, strength: 'strong' },
  ],
  trackingUrl: (n) => `https://track.amazon.com/tracking/${encodeURIComponent(n)}`,
};
