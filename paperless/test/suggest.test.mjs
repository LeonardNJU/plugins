import { describe, it, expect } from 'vitest';
import { bestCorrespondent, bestDocumentType, correspondentScore, matchingTags, rememberChoice, suggestMetadata } from '../src/lib/suggest.js';

const tax = {
  correspondents: [
    { id: 1, name: 'ACME Hosting' },
    { id: 2, name: 'Stadtwerke Hildesheim' },
    { id: 3, name: 'Finanzamt', match: 'elster.de finanzamt', matchingAlgorithm: 1 },
    { id: 4, name: 'Bob Example' },
  ],
  documentTypes: [{ id: 1, name: 'Invoice' }, { id: 2, name: 'Contract' }, { id: 4, name: 'Receipt' }],
  tags: [{ id: 1, name: 'Invoice' }, { id: 3, name: 'Tax' }, { id: 6, name: 'IT' }],
  storagePaths: [{ id: 1, name: 'By correspondent' }],
};

describe('correspondents', () => {
  it('matches by name, by match pattern and by the sender\'s domain', () => {
    expect(bestCorrespondent(tax.correspondents, { name: 'Bob Example', email: 'bob@example.org' })?.id).toBe(4);
    expect(bestCorrespondent(tax.correspondents, { name: 'Bescheid', email: 'noreply@elster.de' })?.id).toBe(3);
    expect(bestCorrespondent(tax.correspondents, { name: 'Billing', email: 'billing@acme-hosting.example' })?.id).toBe(1);
    expect(bestCorrespondent(tax.correspondents, { name: '', email: 'rechnung@stadtwerke-hildesheim.de' })?.id).toBe(2);
    // The name written as one word in the domain.
    expect(bestCorrespondent(tax.correspondents, { name: 'Billing', email: 'billing@acmehosting.com' })?.id).toBe(1);
  });

  it('suggests nothing for an unrelated sender', () => {
    expect(bestCorrespondent(tax.correspondents, { name: 'Newsletter', email: 'news@lists.example' })).toBeNull();
    // Generic words in a domain don't count.
    expect(correspondentScore({ name: 'Mail Service' }, { email: 'info@mail-service-other.example' })).toBe(0);
  });
});

describe('types and tags', () => {
  it('finds the type in the subject, in other languages and compound words too', () => {
    expect(bestDocumentType(tax.documentTypes, 'Your invoice 2026-10')?.id).toBe(1);
    expect(bestDocumentType(tax.documentTypes, 'Ihre Stromrechnung Oktober')?.id).toBe(1);
    expect(bestDocumentType(tax.documentTypes, 'Facture n° 12')?.id).toBe(1);
    expect(bestDocumentType(tax.documentTypes, 'Kassenbon vom Bäcker')?.id).toBe(4);
    expect(bestDocumentType(tax.documentTypes, 'Meeting on Thursday')).toBeNull();
  });

  it('tags named in the text, whole words only and not too short', () => {
    expect(matchingTags(tax.tags, 'Invoice and tax return')).toEqual([1, 3]);
    expect(matchingTags(tax.tags, 'Taxi receipt with IT costs')).toEqual([]);
  });
});

describe('suggestMetadata', () => {
  it('prefers what the user picked for this sender before', () => {
    const remembered = { 'bob@example.org': { correspondent: 2, documentType: 2, tags: [3, 99], storagePath: 1 } };
    expect(suggestMetadata({ sender: { name: 'Bob Example', email: 'Bob@Example.org' }, text: 'Invoice' }, tax, remembered))
      .toEqual({ correspondent: 2, documentType: 2, tags: [3], storagePath: 1, source: 'remembered' });
  });

  it('falls back to matching', () => {
    expect(suggestMetadata({ sender: { name: 'ACME', email: 'billing@acme-hosting.example' }, text: 'Invoice 4711 invoice.pdf' }, tax, {}))
      .toEqual({ correspondent: 1, documentType: 1, tags: [1], storagePath: null, source: 'matched' });
  });

  it('remembers choices per address and keeps the newest', () => {
    let r = {};
    for (let i = 0; i < 5; i++) r = rememberChoice(r, `s${i}@x.org`, { correspondent: i, tags: [1] }, 3);
    expect(Object.keys(r)).toEqual(['s2@x.org', 's3@x.org', 's4@x.org']);
    expect(r['s4@x.org']).toEqual({ correspondent: 4, documentType: null, tags: [1], storagePath: null });
  });
});
