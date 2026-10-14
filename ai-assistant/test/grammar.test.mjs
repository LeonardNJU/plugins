import { describe, it, expect } from 'vitest';
import { diffSuggestions, applySuggestions, pendingSuggestions, tokenize } from '../src/lib/grammar.js';
import { reviewStep } from '../src/lib/grammar.js';
import { buildPrompt } from '../src/lib/prompts.js';

const original = 'hi bob, can we meet on tuesday? i has some  questions.';
const corrected = 'Hi Bob, can we meet on Tuesday? I have some questions.';

describe('diffSuggestions', () => {
  it('splits the corrections into separate suggestions', () => {
    const segs = diffSuggestions(original, corrected);
    const changes = segs.filter((s) => s.kind === 'change').map((s) => [s.from, s.to]);
    expect(changes).toEqual([
      ['hi bob', 'Hi Bob'],
      ['tuesday', 'Tuesday'],
      ['i has', 'I have'],
      ['  ', ' '],
    ]);
    expect(segs.filter((s) => s.kind === 'change').map((s) => s.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
  });

  it('gives nothing to review when the text is fine', () => {
    expect(diffSuggestions('All good.', 'All good.').filter((s) => s.kind === 'change')).toEqual([]);
  });

  it('keeps words with accents and other scripts whole', () => {
    expect(tokenize('Grüße, Ünal! 你好')).toEqual(['Grüße', ',', ' ', 'Ünal', '!', ' ', '你好']);
    const changes = diffSuggestions('Viele Grüse', 'Viele Grüße').filter((s) => s.kind === 'change');
    expect(changes).toEqual([{ kind: 'change', id: 'c0', from: 'Grüse', to: 'Grüße' }]);
  });
});

describe('accepting one by one', () => {
  it('applies only the accepted suggestions and leaves the rest as written', () => {
    const segs = diffSuggestions(original, corrected);
    expect(applySuggestions(segs, {})).toBe(original);
    expect(applySuggestions(segs, { c1: 'accepted', c0: 'skipped' })).toBe('hi bob, can we meet on Tuesday? i has some  questions.');
    expect(applySuggestions(segs, { c0: 'accepted', c1: 'accepted', c2: 'accepted', c3: 'accepted' })).toBe(corrected);
    expect(pendingSuggestions(segs, { c1: 'skipped' }).map((s) => s.id)).toEqual(['c0', 'c2', 'c3']);
  });

  it('turns each decision into the new text', () => {
    const review = { segments: diffSuggestions(original, corrected), states: {} };
    const first = reviewStep(review, 'c2', 'accepted');
    expect(first.text).toBe('hi bob, can we meet on tuesday? I have some  questions.');
    const second = reviewStep(first.review, 'c0', 'skipped');
    expect(second.text).toBe(first.text);
    expect(second.review.states).toEqual({ c2: 'accepted', c0: 'skipped' });
  });
});

describe('grammar prompt', () => {
  it('asks for minimal corrections only', () => {
    const p = buildPrompt('grammar', { text: 'teh text' });
    expect(p.system).toMatch(/Change as little as possible/);
    expect(p.messages[0].content).toContain('teh text');
  });
});
