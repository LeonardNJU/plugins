// Read the structured answers (to-dos and dates, reply ideas) leniently:
// small local models often wrap JSON in prose or code fences, or skip it.

/** The first JSON value of the given kind ('{' or '[') in a text, or null. */
export function findJson(text, open = '{') {
  const value = String(text ?? '');
  const close = open === '{' ? '}' : ']';
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
  const candidates = fenced ? [fenced[1], value] : [value];
  for (const candidate of candidates) {
    const start = candidate.indexOf(open);
    const end = candidate.lastIndexOf(close);
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch { /* try the next */ }
  }
  return null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
}

function bulletLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]\s+(?:\[[ x]\]\s+)?|\d+[.)]\s+|\[[ x]\]\s+)/i, '').trim())
    .filter((l) => l && !/^```/.test(l));
}

/**
 * To-dos and dates from the model's answer:
 * { tasks: [{ text, due }], dates: [{ text, date, time }] }.
 * Without usable JSON, every non-empty line becomes a to-do.
 */
export function parseActionItems(answer) {
  const json = findJson(answer, '{');
  if (json && typeof json === 'object' && (Array.isArray(json.tasks) || Array.isArray(json.dates))) {
    const tasks = (Array.isArray(json.tasks) ? json.tasks : [])
      .map((t) => (typeof t === 'string' ? { text: cleanText(t), due: null } : {
        text: cleanText(t?.text),
        due: DATE_RE.test(t?.due ?? '') ? t.due : null,
      }))
      .filter((t) => t.text);
    const dates = (Array.isArray(json.dates) ? json.dates : [])
      .map((d) => ({
        text: cleanText(d?.text),
        date: DATE_RE.test(d?.date ?? '') ? d.date : null,
        time: TIME_RE.test(d?.time ?? '') ? d.time : null,
      }))
      .filter((d) => d.text);
    return { tasks: tasks.slice(0, 30), dates: dates.slice(0, 30) };
  }
  return { tasks: bulletLines(answer).slice(0, 30).map((text) => ({ text: cleanText(text), due: null })), dates: [] };
}

/** Plain text for the clipboard: a checklist and a list of dates. */
export function formatActionItems(items, { tasksTitle = 'To-dos', datesTitle = 'Dates' } = {}) {
  const parts = [];
  if (items.tasks.length) {
    parts.push(`${tasksTitle}:\n${items.tasks.map((t) => `- [ ] ${t.text}${t.due ? ` (${t.due})` : ''}`).join('\n')}`);
  }
  if (items.dates.length) {
    parts.push(`${datesTitle}:\n${items.dates.map((d) => `- ${[d.date, d.time].filter(Boolean).join(' ')}${d.date ? ': ' : ''}${d.text}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** Up to three reply suggestions from the model's answer. */
export function parseReplies(answer, max = 3) {
  const json = findJson(answer, '[');
  if (Array.isArray(json)) {
    const list = json
      .map((r) => (typeof r === 'string' ? r : (r?.text ?? r?.reply ?? '')))
      .map((r) => String(r).trim())
      .filter(Boolean);
    if (list.length) return list.slice(0, max);
  }
  // Without usable JSON: drop code fences and JSON brackets, keep the text.
  const text = String(answer ?? '')
    .replace(/^\s*```\w*\s*$/gm, '')
    .replace(/^\s*[[\]]\s*$/gm, '')
    .trim();
  if (!text) return [];
  // "1. ...", "2. ..." or "- ..." lists.
  const numbered = text.split(/\r?\n(?=\s*(?:\d+[.)]|[-*•])\s+)/)
    .map((p) => p.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim())
    .filter(Boolean);
  if (numbered.length > 1) return numbered.slice(0, max);
  const paragraphs = text.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.slice(0, max);
}
