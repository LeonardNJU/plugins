import { describe, expect, it } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { formatContacts, formatEvents, runTool, toolsFor } from '../src/lib/tools.js';

// What the model may look up: offered by context and setting, run through
// the api, answered as text.

describe('toolsFor', () => {
  it('offers the original message only in a reply, and the lookups unless turned off', () => {
    expect(toolsFor({}).map((t) => t.name)).toEqual(['check_calendar', 'find_contact']);
    expect(toolsFor({ inReplyToId: 'M1' }).map((t) => t.name)).toEqual(['read_original_message', 'check_calendar', 'find_contact']);
    expect(toolsFor({ inReplyToId: 'M1', lookups: false }).map((t) => t.name)).toEqual(['read_original_message']);
    expect(toolsFor({ lookups: false })).toEqual([]);
    for (const tool of toolsFor({ inReplyToId: 'M1' })) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters.type).toBe('object');
    }
  });
});

describe('runTool', () => {
  it('reads the message the user replies to', async () => {
    const api = fakeApi({ handlers: { 'email.get': async (id) => ({ id, from: [{ name: 'Carol', email: 'carol@example.org' }], receivedAt: '2026-10-12T09:00:00Z', subject: 'Thursday', text: 'Can we meet?' }) } });
    const text = await runTool(api, 'read_original_message', {}, { inReplyToId: 'M1' });
    expect(text).toBe('From: Carol <carol@example.org>\nDate: 2026-10-12T09:00:00Z\nSubject: Thursday\n\nCan we meet?');
    expect(api.calls('email.get').map((c) => c.args)).toEqual([['M1']]);
    await expect(runTool(api, 'read_original_message', {}, {})).rejects.toThrow(/no original message/);
  });

  it('lists calendar events for a range, the end day included, and clamps odd ranges', async () => {
    const asked = [];
    const api = fakeApi({ handlers: { 'calendar.getEvents': async (q) => { asked.push(q); return [
      { title: 'Standup', utcStart: '2026-10-22T08:00:00Z', utcEnd: '2026-10-22T08:15:00Z', isAllDay: false, location: '' },
      { title: 'Offsite', start: '2026-10-23', isAllDay: true },
    ]; } } });
    const text = await runTool(api, 'check_calendar', { from: '2026-10-22', to: '2026-10-23' });
    expect(asked).toEqual([{ from: '2026-10-22', to: '2026-10-24' }]);
    expect(text).toContain('Events between 2026-10-22 and 2026-10-23');
    expect(text).toContain('Standup');
    expect(text).toContain('2026-10-23 (all day): Offsite');

    await runTool(api, 'check_calendar', { from: '2026-10-22', to: '2026-12-31' });
    expect(asked[1]).toEqual({ from: '2026-10-22', to: '2026-11-23' });
    await runTool(api, 'check_calendar', { from: '2026-10-22', to: '2026-10-01' });
    expect(asked[2]).toEqual({ from: '2026-10-22', to: '2026-10-23' });
    await expect(runTool(api, 'check_calendar', { from: 'tomorrow' })).rejects.toThrow(/date/);
  });

  it('finds contacts and keeps the list short', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ fullName: `Person ${i}`, emails: [`p${i}@example.org`], company: i === 0 ? 'ACME' : '' }));
    const api = fakeApi({ handlers: { 'contacts.search': async () => many } });
    const text = await runTool(api, 'find_contact', { query: 'Person' });
    expect(text.split('\n')).toHaveLength(6);
    expect(text).toContain('- Person 0: p0@example.org (ACME)');
    expect(api.calls('contacts.search').map((c) => c.args)).toEqual([['Person']]);
    await expect(runTool(api, 'find_contact', { query: '  ' })).rejects.toThrow(/empty/);
    await expect(runTool(api, 'nope', {})).rejects.toThrow(/unknown tool/);
  });
});

describe('formatting', () => {
  it('says when there is nothing', () => {
    expect(formatEvents([], { from: '2026-10-22', to: '2026-10-22' })).toBe('No events between 2026-10-22 and 2026-10-22.');
    expect(formatContacts([], 'Zed')).toBe('No contact matches "Zed".');
  });
});
