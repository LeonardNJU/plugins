import { describe, it, expect } from 'vitest';
import { findRule, markProcessed, normalizeRule, ruleMatches, senderMatches } from '../src/lib/rules.js';

const mail = (email, subject = 'Invoice 10/2026', extra = {}) => ({
  id: 'm1', from: [{ name: 'Billing', email }], subject, hasAttachment: true, receivedAt: '2026-10-14T10:00:00Z', ...extra,
});
const on = (raw) => normalizeRule({ enabled: true, enabledAt: Date.parse('2026-10-14T09:00:00Z'), ...raw });

describe('senderMatches', () => {
  it('reads an address, a domain or a part of the name', () => {
    expect(senderMatches('billing@acme.com', { email: 'Billing@ACME.com' })).toBe(true);
    expect(senderMatches('billing@acme.com', { email: 'sales@acme.com' })).toBe(false);
    expect(senderMatches('@acme.com', { email: 'x@mail.acme.com' })).toBe(true);
    expect(senderMatches('acme.com', { email: 'x@notacme.com' })).toBe(false);
    expect(senderMatches('stadtwerke', { name: 'Stadtwerke Hildesheim', email: 'noreply@sw-hi.de' })).toBe(true);
  });
});

describe('rules', () => {
  it('is off until the user switches it on', () => {
    const rule = normalizeRule({ from: '@acme.com' });
    expect(rule.enabled).toBe(false);
    expect(ruleMatches(rule, mail('a@acme.com'))).toBe(false);
    expect(normalizeRule({ from: '  ' })).toBeNull();
  });

  it('matches sender and subject, and needs an attachment to send attachments', () => {
    expect(ruleMatches(on({ from: '@acme.com', subject: 'invoice' }), mail('a@acme.com'))).toBe(true);
    expect(ruleMatches(on({ from: '@acme.com', subject: 'contract' }), mail('a@acme.com'))).toBe(false);
    expect(ruleMatches(on({ from: '@acme.com' }), mail('a@acme.com', 'x', { hasAttachment: false }))).toBe(false);
    expect(ruleMatches(on({ from: '@acme.com', what: 'message' }), mail('a@acme.com', 'x', { hasAttachment: false }))).toBe(true);
  });

  it('never touches mail from before the rule was switched on', () => {
    expect(ruleMatches(on({ from: '@acme.com' }), mail('a@acme.com', 'x', { receivedAt: '2026-10-13T10:00:00Z' }))).toBe(false);
  });

  it('finds the first enabled rule that fits', () => {
    const rules = [{ from: '@acme.com', enabled: false }, on({ id: 'b', from: 'acme' }), on({ id: 'c', from: '@acme.com' })];
    expect(findRule(rules, mail('a@acme.com')).id).toBe('b');
    expect(findRule(rules, mail('a@other.org'))).toBeNull();
  });

  it('remembers processed messages once, with a cap', () => {
    let list = [];
    ({ list } = markProcessed(list, 'a', 2));
    expect(markProcessed(list, 'a', 2).added).toBe(false);
    ({ list } = markProcessed(list, 'b', 2));
    ({ list } = markProcessed(list, 'c', 2));
    expect(list).toEqual(['b', 'c']);
  });
});
