// Hermes (Germany) and Evri (Hermes UK). No published check digits.
export default {
  id: 'hermes',
  name: 'Hermes',
  keywords: /\bHermes\b|\bEvri\b|myhermes/i,
  formats: [
    // "H" followed by 15-19 digits or capitals (Hermes DE 20-character IDs,
    // Evri 16). At least ten digits in a row, so words in capitals don't match.
    { re: /\bH[0-9A-Z]{15,19}\b/g, strength: 'medium', check: (n) => /\d{10}/.test(n) },
    // Hermes DE 14-digit numbers.
    { re: /\b\d{14}\b/g, strength: 'weak' },
  ],
  trackingUrl: (n) => `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${encodeURIComponent(n)}`,
};
