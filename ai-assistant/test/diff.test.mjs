import { describe, it, expect } from 'vitest';
import { diffWords, hasChanges, plainParts } from '../src/lib/diff.js';
import { diffSuggestions, reviewParts, acceptAll } from '../src/lib/grammar.js';

const joined = (parts, types) => parts.filter((p) => types.includes(p.type)).map((p) => p.text).join('');

describe('diffWords', () => {
  it('marks changed words and keeps the rest', () => {
    expect(diffWords('Can we meet on Tuesday?', 'Could we meet on Wednesday?')).toEqual([
      { type: 'del', text: 'Can' },
      { type: 'add', text: 'Could' },
      { type: 'same', text: ' we meet on ' },
      { type: 'del', text: 'Tuesday' },
      { type: 'add', text: 'Wednesday' },
      { type: 'same', text: '?' },
    ]);
  });

  it('gives back both texts: same+del is the old one, same+add the new one', () => {
    const before = 'hi bob,\n\ncan we meet tuesday? i has questions';
    const after = 'Hi Bob,\n\nCould we meet on Tuesday? I have a few questions.';
    const parts = diffWords(before, after);
    expect(parts.map((p) => p.text).join('').length).toBeGreaterThan(after.length);
    expect(parts.filter((p) => p.type !== 'add').map((p) => p.text).join('')).toBe(before);
    expect(parts.filter((p) => p.type !== 'del').map((p) => p.text).join('')).toBe(after);
  });

  it('treats a whole word as the unit, not letters', () => {
    const parts = diffWords('the cat sat', 'the cart sat');
    expect(joined(parts, ['del'])).toBe('cat');
    expect(joined(parts, ['add'])).toBe('cart');
  });

  it('has no changes for the same text', () => {
    const parts = diffWords('Same text.', 'Same text.');
    expect(parts).toEqual([{ type: 'same', text: 'Same text.' }]);
    expect(hasChanges(parts)).toBe(false);
    expect(hasChanges(diffWords('a', 'b'))).toBe(true);
  });

  it('while the answer is still coming, does not mark the original it has not reached as removed', () => {
    const before = 'Hello Bob, can we meet on Tuesday? I have questions.';
    const partial = 'Hello Bob, could we me';
    const parts = diffWords(before, partial, { partial: true });
    expect(parts.filter((p) => p.type !== 'del').map((p) => p.text).join('')).toBe(partial);
    expect(joined(parts, ['del'])).not.toContain('Tuesday');
    // Finished, the same answer marks what is gone.
    expect(joined(diffWords(before, partial), ['del'])).toContain('Tuesday');
  });

  it('shows a text written from nothing unmarked', () => {
    expect(plainParts('Dear Anna')).toEqual([{ type: 'same', text: 'Dear Anna' }]);
    expect(plainParts('')).toEqual([]);
  });
});

describe('reviewParts', () => {
  it('marks open grammar suggestions and shows decided ones as they now read', () => {
    const segments = diffSuggestions('i has teh offer', 'I have the offer');
    const ids = segments.filter((s) => s.kind === 'change').map((s) => s.id);
    const open = reviewParts(segments, {});
    expect(joined(open, ['same', 'add'])).toBe('I have the offer');
    const decided = reviewParts(segments, Object.fromEntries(ids.map((id) => [id, 'skipped'])));
    expect(decided).toEqual([{ type: 'same', text: 'i has teh offer' }]);
    expect(acceptAll({ segments, states: {} }).text).toBe('I have the offer');
  });
});
