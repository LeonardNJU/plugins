// Priority: the four levels the webmail's own task form has (none, low,
// medium, high), guessed from the message and mapped to each service.

export const PRIORITIES = ['none', 'low', 'medium', 'high'];

const URGENT_WORDS = /(?<![\p{L}\p{N}])(urgent|asap|important|high priority|dringend|eilig|eilt|wichtig|hohe priorität|sofort)(?![\p{L}\p{N}])/iu;

function header(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return String(Array.isArray(value) ? value[0] : value ?? '');
  }
  return '';
}

/** 'high' for a message marked urgent (headers or subject), 'low' for one marked low, else 'none'. */
export function detectPriority({ subject, headers }) {
  const xPriority = header(headers, 'x-priority').trim();
  const importance = header(headers, 'importance').trim().toLowerCase();
  const priority = header(headers, 'priority').trim().toLowerCase();
  if (/^[12](\D|$)/.test(xPriority) || importance === 'high' || priority === 'urgent') return 'high';
  if (URGENT_WORDS.test(String(subject ?? ''))) return 'high';
  if (/^[45](\D|$)/.test(xPriority) || importance === 'low' || priority === 'non-urgent') return 'low';
  return 'none';
}

/** The level as each service stores it. */
export function priorityFor(target, level) {
  const i = Math.max(0, PRIORITIES.indexOf(level));
  switch (target) {
    // JSCalendar and iCalendar: 0 none, 1 highest ... 9 lowest; the webmail
    // writes 1, 5 and 9.
    case 'bulwark':
    case 'caldav':
      return [0, 9, 5, 1][i];
    // Vikunja: 0 unset, 1 low, 2 medium, 3 high (4 urgent, 5 do now).
    case 'vikunja':
      return [0, 1, 2, 3][i];
    // Todoist: 1 normal (p4) ... 4 urgent (p1).
    case 'todoist':
      return [1, 2, 3, 4][i];
    default:
      return 0;
  }
}
