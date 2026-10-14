import { describe, expect, it } from 'vitest';
import { detectParcels, identifyNumber, parcelFromInput } from '../src/lib/detect.js';
import { htmlFromSource, structuredParcels } from '../src/lib/structured.js';

const mail = (text, extra = {}) => ({ subject: '', from: [], text, ...extra });
const found = (text, extra) => detectParcels(mail(text, extra)).map((p) => `${p.carrier}:${p.number}`);

// Real-format numbers in the sentences shipping mails use. Every one of
// them must be found, with the right carrier.
const MUST_DETECT = [
  ['Ihre Sendungsnummer: 00340434161094042557', 'dhl:00340434161094042557'],
  ['DHL Sendungsnummer 0034 0434 1610 9404 2557', 'dhl:00340434161094042557'],
  ['Tracking: JJD000390007878901234', 'dhl:JJD000390007878901234'],
  ['Your DHL Express waybill number is 3318810025.', 'dhl:3318810025'],
  ['DHL Paket – Sendungsnummer: 123456789012', 'dhl:123456789012'],
  ['Einschreiben, Sendungsnummer RR123456785DE', 'dhl:RR123456785DE'],
  ['UPS tracking number: 1Z999AA10123456784', 'ups:1Z999AA10123456784'],
  ['Track your package: 1Z 999 AA1 01 2345 678 4', 'ups:1Z999AA10123456784'],
  ['1Z5R89390357567127', 'ups:1Z5R89390357567127'],
  ['FedEx tracking number: 986578788855', 'fedex:986578788855'],
  ['Your FedEx Ground tracking number is 612999988208210', 'fedex:612999988208210'],
  ['USPS Tracking Number: 9205590164917312751089', 'usps:9205590164917312751089'],
  ['Tracking 420221539101026837331000039521 (USPS)', 'usps:9101026837331000039521'],
  ['Royal Mail tracking: EE123456785GB', 'royalmail:EE123456785GB'],
  ['PostNL Track & Trace: 3SABCD1234567', 'postnl:3SABCD1234567'],
  ['Zending CP123456785NL is onderweg', 'postnl:CP123456785NL'],
  ['Amazon tracking ID: TBA123456789012', 'amazon:TBA123456789012'],
  ['DPD Paketnummer: 01505012345678', 'dpd:01505012345678'],
  ['Hermes Sendungsnummer: 12345678901234', 'hermes:12345678901234'],
  ['Ihre Hermes Sendung H1004190001234567890 ist unterwegs', 'hermes:H1004190001234567890'],
  ['GLS Paketnummer: 12345678901', 'gls:12345678901'],
  ['Registered mail RB123456785CH', 'post:RB123456785CH'],
];

// Numbers that look like tracking numbers but are not. None may be found.
const MUST_NOT_DETECT = [
  // Order numbers
  'Order number: 3318810025 (shipped with DHL)',
  'Bestellnummer 01505012345678 – Versand mit DPD',
  'Order #302-1234567-1234567 has shipped via UPS',
  'Bestellung Nr. 028-4455667-8899001, Versand mit DHL',
  'Your order 9205590164917312751089 is confirmed. USPS will deliver it.',
  'Auftragsnummer: 12345678901234 – Hermes Versand folgt',
  // Customer and reference numbers
  'Ihre Kundennummer bei DHL: 3318810025',
  'Reference 123456789012 for your DHL shipment',
  'Your FedEx account number: 986578788855',
  // Invoice numbers
  'Invoice no. 986578788855 for your FedEx shipment',
  'Rechnungsnummer 4711000814 – Ihre DHL Sendung',
  'Invoice INV-2026-000123 for your parcel',
  'Rechnung RE-2026-10-0042, Paket mit DPD',
  // Phone numbers
  'DHL Kundenservice: 0228 4333112',
  'Questions about your parcel? Call +49 228 18210025 (DHL)',
  'Fragen zur Sendung? Tel. 02281821002 (GLS)',
  'Parcel hotline (555) 123-4567, FedEx',
  'Paket-Hotline +4922818210025 (DHL)',
  // IBANs and bank details
  'IBAN: DE89 3704 0044 0532 0130 00 – DHL Paket',
  'IBAN DE89370400440532013000 (DHL shipping fee)',
  'IBAN NL91ABNA0417164300, PostNL zending',
  'Bank account GB82 WEST 1234 5698 7654 32, Royal Mail parcel',
  // Dates, ids and codes
  'DPD Paket. Erstellt am 20261014123045',
  'Join the meeting (ID 3318810025). Your DHL parcel arrives tomorrow.',
  'Your verification code is 1234567891',
  'Hermes card 4111111111111111',
  // Part of a longer compound: a date with a slash, a leading plus
  'DHL Sendung 14.10.2026/3318810025',
  'DHL Paket-Hotline: +3318810025',
  // Right shape, wrong check digit
  'UPS tracking: 1Z999AA10123456785',
  'Sendungsnummer RR123456789DE',
  'Tracking LX123456789DE',
  'Tracking 00340434161094042558',
  'USPS tracking 9400111899223197428490',
  'FedEx tracking number: 986578788856',
  // Right shape, no carrier anywhere
  'Your tracking number: 12345678901234',
  'Tracking number 3318810025',
];

describe('detectParcels: real numbers', () => {
  it.each(MUST_DETECT)('%s', (text, expected) => {
    expect(found(text)).toEqual([expected]);
  });

  it('finds both numbers in the seeded shipping mail', () => {
    const message = {
      subject: 'Your order has shipped',
      from: [{ name: 'Shop', email: 'orders@shop.example' }],
      text: 'Your parcel is on its way.\n\nDHL tracking number: 00340434161094042557\nUPS: 1Z999AA10123456784\n\nThanks for your order.',
    };
    const parcels = detectParcels(message);
    expect(parcels.map((p) => p.number)).toEqual(['00340434161094042557', '1Z999AA10123456784']);
    expect(parcels[0]).toMatchObject({ carrier: 'dhl', carrierName: 'DHL', source: 'text' });
    expect(parcels[0].trackingUrl).toContain('tracking-id=00340434161094042557');
    expect(parcels[1].trackingUrl).toBe('https://www.ups.com/track?tracknum=1Z999AA10123456784');
  });

  it('takes the carrier from the sender when the text only says "parcel number"', () => {
    expect(found('Ihre Paketnummer: 01505012345678', { from: [{ name: 'DPD', email: 'noreply@dpd.de' }] }))
      .toEqual(['dpd:01505012345678']);
  });

  it('picks the carrier named next to an ambiguous number', () => {
    const text = 'Teil 1 kommt mit Hermes.\n\nDPD Paketnummer: 01505012345678';
    expect(found(text)).toEqual(['dpd:01505012345678']);
    const other = 'Teil 1 kommt mit DPD.\n\nHermes Sendungsnummer: 01505012345678';
    expect(found(other)).toEqual(['hermes:01505012345678']);
  });

  it('accepts a tracking label that mentions the order', () => {
    expect(found('Tracking number for your order: 3318810025 (DHL Express)')).toEqual(['dhl:3318810025']);
  });

  it('lists each number once, in text order', () => {
    const text = 'UPS: 1Z999AA10123456784\nTrack: https://www.ups.com/track?tracknum=1Z999AA10123456784\nDHL: JJD000390007878901234';
    expect(found(text)).toEqual(['ups:1Z999AA10123456784', 'dhl:JJD000390007878901234']);
  });

  it('stops at ten numbers', () => {
    const text = Array.from({ length: 15 }, (_, i) => `TBA1234567890${String(i).padStart(2, '0')}`).join('\n');
    expect(detectParcels(mail(text))).toHaveLength(10);
  });
});

describe('detectParcels: false positives', () => {
  it.each(MUST_NOT_DETECT)('%s', (text) => {
    expect(found(text)).toEqual([]);
  });
});

describe('schema.org ParcelDelivery', () => {
  const jsonLd = (data) => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body>Hi</body></html>`;

  it('reads JSON-LD, including nested Order.orderDelivery and @graph', () => {
    const html = jsonLd({
      '@context': 'http://schema.org',
      '@graph': [
        { '@type': 'Order', orderNumber: '123-456', orderDelivery: {
          '@type': 'ParcelDelivery', trackingNumber: 'H1004190001234567890',
          carrier: { '@type': 'Organization', name: 'Hermes' },
          trackingUrl: 'https://www.myhermes.de/track/H1004190001234567890',
        } },
        { '@type': 'ParcelDelivery', trackingNumber: 'JJD000390007878901234', provider: { name: 'DHL' } },
      ],
    });
    const parcels = detectParcels({ subject: 'Bestellung', text: 'Hi', html });
    expect(parcels).toEqual([
      { number: 'H1004190001234567890', carrier: 'hermes', carrierName: 'Hermes', trackingUrl: 'https://www.myhermes.de/track/H1004190001234567890', source: 'schema' },
      expect.objectContaining({ number: 'JJD000390007878901234', carrier: 'dhl', source: 'schema' }),
    ]);
  });

  it('keeps a carrier it has no module for, with the mail\'s own tracking link', () => {
    const html = jsonLd({ '@type': 'ParcelDelivery', trackingNumber: '9960 1234 5612 3456', carrier: 'Swiss Post', trackingUrl: 'https://service.post.ch/track?n=9960123456123456' });
    expect(detectParcels({ text: '', html })).toEqual([{
      number: '9960123456123456', carrier: 'other', carrierName: 'Swiss Post',
      trackingUrl: 'https://service.post.ch/track?n=9960123456123456', source: 'schema',
    }]);
  });

  it('reads microdata', () => {
    const html = `<div itemscope itemtype="http://schema.org/ParcelDelivery">
      <meta itemprop="trackingNumber" content="TBA123456789012">
      <div itemprop="carrier" itemscope itemtype="http://schema.org/Organization"><span itemprop="name">Amazon</span></div>
      <link itemprop="trackingUrl" href="https://track.amazon.com/tracking/TBA123456789012">
    </div>`;
    expect(structuredParcels(html)).toEqual([{ number: 'TBA123456789012', carrierName: 'Amazon', trackingUrl: 'https://track.amazon.com/tracking/TBA123456789012' }]);
    expect(detectParcels({ text: '', html })[0]).toMatchObject({ carrier: 'amazon', source: 'schema' });
  });

  it('ignores broken JSON-LD and javascript: links', () => {
    const html = '<script type="application/ld+json">{ not json</script>'
      + '<script type="application/ld+json">{"@type":"ParcelDelivery","trackingNumber":"1Z999AA10123456784","trackingUrl":"javascript:alert(1)"}</script>';
    const parcels = detectParcels({ text: '', html });
    expect(parcels).toHaveLength(1);
    expect(parcels[0].trackingUrl).toBe('https://www.ups.com/track?tracknum=1Z999AA10123456784');
  });

  it('finds the HTML part in the plugin view\'s source text', () => {
    const source = '=== EMAIL HEADERS ===\n\nSubject: x\n\n=== EMAIL BODY ===\n\n--- Plain Text Version ---\n\nHi\n\n--- HTML Version ---\n\n'
      + '<script type="application/ld+json">{"@type":"ParcelDelivery","trackingNumber":"JJD000390007878901234","carrier":{"name":"DHL"}}</script>';
    expect(htmlFromSource(source)).toContain('application/ld+json');
    expect(detectParcels({ subject: 'x', text: 'Hi', source }).map((p) => p.number)).toEqual(['JJD000390007878901234']);
    expect(htmlFromSource('no html here')).toBe('');
  });
});

describe('numbers the user types', () => {
  it('knows the carrier of distinctive formats', () => {
    expect(parcelFromInput(' 1z999aa10123456784 ')).toMatchObject({ carrier: 'ups', number: '1Z999AA10123456784', source: 'manual' });
    expect(parcelFromInput('JJD000390007878901234')).toMatchObject({ carrier: 'dhl' });
  });

  it('leaves bare digit runs to the tracking service', () => {
    expect(parcelFromInput('01505012345678')).toMatchObject({ carrier: 'other', carrierName: '' });
    expect(parcelFromInput('01505012345678').trackingUrl).toContain('17track.net');
  });

  it('refuses text that is not a number', () => {
    expect(parcelFromInput('hello')).toBeNull();
    expect(parcelFromInput('')).toBeNull();
  });

  it('identifyNumber applies the check digits', () => {
    expect(identifyNumber('1Z999AA10123456784')?.carrier.id).toBe('ups');
    expect(identifyNumber('1Z999AA10123456785')).toBeNull();
  });
});
