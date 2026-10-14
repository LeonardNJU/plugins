// Grammar fixes as separate suggestions. The model returns the corrected
// text; a word diff against the original splits it into changes the user
// accepts or skips one by one.

const TOKEN_RE = /\s+|[\p{L}\p{N}\p{M}'’_-]+|[^\s\p{L}\p{N}\p{M}]/gu;
/** Above this many tokens in the changed middle, the whole middle is one change. */
const MAX_DIFF_TOKENS = 4000;

export function tokenize(text) {
  return String(text ?? '').match(TOKEN_RE) ?? [];
}

/** Longest common subsequence diff of two token lists: [{ op: '=', '-', '+', token }]. */
function lcsDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: '=', token: a[i] }); i++; j++; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { out.push({ op: '-', token: a[i] }); i++; }
    else { out.push({ op: '+', token: b[j] }); j++; }
  }
  while (i < n) out.push({ op: '-', token: a[i++] });
  while (j < m) out.push({ op: '+', token: b[j++] });
  return out;
}

/**
 * Segments of the text: { kind: 'same', text } and
 * { kind: 'change', id, from, to }. Changes separated only by spaces are
 * merged, so "teh  cat" → "the cat" is one suggestion, not two.
 */
export function diffSuggestions(original, corrected) {
  const a = tokenize(original);
  const b = tokenize(corrected);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const ops = [];
  for (let k = 0; k < start; k++) ops.push({ op: '=', token: a[k] });
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_DIFF_TOKENS * MAX_DIFF_TOKENS / 4 || midA.length > MAX_DIFF_TOKENS || midB.length > MAX_DIFF_TOKENS) {
    for (const token of midA) ops.push({ op: '-', token });
    for (const token of midB) ops.push({ op: '+', token });
  } else {
    ops.push(...lcsDiff(midA, midB));
  }
  for (let k = endA; k < a.length; k++) ops.push({ op: '=', token: a[k] });

  // Group into same / change runs.
  const raw = [];
  for (const { op, token } of ops) {
    const kind = op === '=' ? 'same' : 'change';
    let last = raw[raw.length - 1];
    if (!last || last.kind !== kind) {
      last = kind === 'same' ? { kind, text: '' } : { kind, from: '', to: '' };
      raw.push(last);
    }
    if (op === '=') last.text += token;
    else if (op === '-') last.from += token;
    else last.to += token;
  }

  // Merge change, whitespace-only same, change.
  const merged = [];
  for (let k = 0; k < raw.length; k++) {
    const seg = raw[k];
    const prev = merged[merged.length - 1];
    const next = raw[k + 1];
    if (seg.kind === 'same' && /^\s+$/.test(seg.text) && prev?.kind === 'change' && next?.kind === 'change') {
      prev.from += seg.text + next.from;
      prev.to += seg.text + next.to;
      k++;
      continue;
    }
    merged.push({ ...seg });
  }

  let id = 0;
  return merged
    .filter((s) => s.kind === 'same' ? s.text !== '' : s.from !== s.to)
    .map((s) => (s.kind === 'change' ? { ...s, id: `c${id++}` } : s));
}

/** The text with accepted changes applied and every other change left as it was. */
export function applySuggestions(segments, states = {}) {
  return segments.map((s) => {
    if (s.kind === 'same') return s.text;
    return states[s.id] === 'accepted' ? s.to : s.from;
  }).join('');
}

export function pendingSuggestions(segments, states = {}) {
  return segments.filter((s) => s.kind === 'change' && !states[s.id]);
}

/** Review state after one decision; `text` is what the user's text becomes. */
export function reviewStep(review, id, state) {
  const states = { ...review.states, [id]: state };
  return { review: { ...review, states }, text: applySuggestions(review.segments, states) };
}

/** Accept every suggestion not decided yet. */
export function acceptAll(review) {
  const states = { ...review.states };
  for (const s of pendingSuggestions(review.segments, states)) states[s.id] = 'accepted';
  return { review: { ...review, states }, text: applySuggestions(review.segments, states) };
}

/** DiffView parts of a review: open suggestions marked, decided ones as they now read. */
export function reviewParts(segments, states = {}) {
  const parts = [];
  const push = (type, text) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  for (const s of segments) {
    if (s.kind === 'same') push('same', s.text);
    else if (states[s.id] === 'accepted') push('same', s.to);
    else if (states[s.id] === 'skipped') push('same', s.from);
    else { push('del', s.from); push('add', s.to); }
  }
  return parts;
}
