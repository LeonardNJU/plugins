// The user's own text in a draft: without the quoted message of a reply,
// the forwarded message and the signature. Only that part is offered to
// the assistant, so it doesn't send the quoted mail along.

const REPLY_HEADER_RE = /:\s*$/;
const FORWARD_RE = /^-{3,}.*-{3,}\s*$|^-{5,}\s*$/;
const SIGNATURE_RE = /^-- ?$/;

export function ownText(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SIGNATURE_RE.test(line) || FORWARD_RE.test(line.trim())) { end = i; break; }
    if (/^\s*>/.test(line)) {
      // "On Tue, Alice wrote:" right above the quote belongs to it.
      let cut = i;
      while (cut > 0 && lines[cut - 1].trim() === '') cut--;
      if (cut > 0 && REPLY_HEADER_RE.test(lines[cut - 1])) cut--;
      end = cut;
      break;
    }
  }
  return lines.slice(0, end).join('\n').trim();
}

/** A small undo stack for the text the assistant works on. */
export function createHistory(initial = '', limit = 50) {
  const past = [];
  let current = initial;
  return {
    get current() { return current; },
    get canUndo() { return past.length > 0; },
    /** Replace the text; the old one can be brought back with undo(). */
    apply(next) {
      if (next === current) return current;
      past.push(current);
      if (past.length > limit) past.shift();
      current = next;
      return current;
    },
    /** Edits typed by the user: no undo step for every key press. */
    set(next) {
      current = next;
      return current;
    },
    undo() {
      if (past.length) current = past.pop();
      return current;
    },
  };
}
