// Word-level changes between the user's text and the assistant's version,
// as the parts the UI kit's DiffView draws: { type: 'same' | 'del' | 'add', text }.
// Built on the grammar module's word diff, so spaces and punctuation are
// tokens of their own and "teh  cat" → "the cat" is one change.

import { diffSuggestions } from './grammar.js';

function push(parts, type, text) {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && last.type === type) last.text += text;
  else parts.push({ type, text });
}

/**
 * The parts that turn `before` into `after`. A change shows the removed
 * words first, then the added ones.
 *
 * `partial: true` is for an answer that is still coming in: the original
 * text the answer hasn't reached yet is not shown as removed, and the last
 * change shows only what was written so far.
 */
export function diffWords(before, after, { partial = false } = {}) {
  const segments = diffSuggestions(String(before ?? ''), String(after ?? ''));
  const parts = [];
  segments.forEach((seg, i) => {
    if (seg.kind === 'same') {
      push(parts, 'same', seg.text);
      return;
    }
    const last = i === segments.length - 1;
    if (!(partial && last)) push(parts, 'del', seg.from);
    push(parts, 'add', seg.to);
  });
  return parts;
}

/** Parts for a text that is all new (writing from nothing): no marking. */
export function plainParts(text) {
  return text ? [{ type: 'same', text }] : [];
}

/** Whether the parts change anything. */
export function hasChanges(parts) {
  return parts.some((p) => p.type !== 'same');
}
