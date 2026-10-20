// What the model may look up while it answers (tool calls): the message a
// reply is for, the user's calendar, a contact's address. Each lookup goes
// through the webmail's api, so the plugin's permissions apply, and every
// one is shown in the chat as a step. Results are text for the model;
// mail and contact data in them is untrusted like everything else.

import { clip } from './prompts.js';

/** Longest tool result handed to the model, in characters. */
export const MAX_TOOL_RESULT = 8000;
/** Longest stretch of days one calendar lookup covers. */
export const MAX_CALENDAR_DAYS = 31;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFINITIONS = {
  read_original_message: {
    description: 'Read the email the user is replying to or forwarding: sender, date, subject and text.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  check_calendar: {
    description: 'List the user\'s calendar events between two dates (inclusive, at most 31 days), to find free or busy times. Dates are YYYY-MM-DD.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  find_contact: {
    description: 'Find a person in the user\'s address book by name or part of an email address: full name, email addresses, company.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name or part of the address' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

/**
 * The tools for a chat: `ctx.inReplyToId` offers the original message,
 * `ctx.lookups` (the user's setting) the calendar and the address book.
 */
export function toolsFor(ctx = {}) {
  const names = [];
  if (ctx.inReplyToId) names.push('read_original_message');
  if (ctx.lookups !== false) names.push('check_calendar', 'find_contact');
  return names.map((name) => ({ name, ...DEFINITIONS[name] }));
}

function person(p) {
  if (!p) return '';
  return p.name && p.email ? `${p.name} <${p.email}>` : (p.email || p.name || '');
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Events as lines the model reads: one per event, day first. */
export function formatEvents(events, { from, to, locale = 'en' } = {}) {
  if (!events.length) return `No events between ${from} and ${to}.`;
  const fmt = (value) => {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    } catch {
      return value;
    }
  };
  const lines = events.slice(0, 60).map((e) => {
    const when = e.isAllDay ? `${String(e.start ?? '').slice(0, 10)} (all day)` : `${fmt(e.utcStart ?? e.start)}${e.utcEnd ? ` to ${fmt(e.utcEnd)}` : (e.duration ? `, ${e.duration}` : '')}`;
    const where = e.location ? ` at ${e.location}` : '';
    return `- ${when}: ${e.title || '(no title)'}${where}`;
  });
  if (events.length > 60) lines.push(`(${events.length - 60} more events not listed)`);
  return `Events between ${from} and ${to}, in the user's time zone:\n${lines.join('\n')}`;
}

/** Contacts as lines the model reads. */
export function formatContacts(contacts, query) {
  const list = contacts.slice(0, 5).map((c) => {
    const name = c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '(no name)';
    const emails = (c.emails ?? []).join(', ') || 'no email address';
    return `- ${name}: ${emails}${c.company ? ` (${c.company})` : ''}`;
  });
  return list.length ? `Contacts matching "${query}":\n${list.join('\n')}` : `No contact matches "${query}".`;
}

/**
 * Run one tool. Resolves to text for the model; throws when the lookup
 * failed (the chat tells the model so).
 */
export async function runTool(api, name, args = {}, ctx = {}) {
  switch (name) {
    case 'read_original_message': {
      if (!ctx.inReplyToId) throw new Error('there is no original message');
      const email = await api.email.get(ctx.inReplyToId);
      if (!email) throw new Error('the message could not be read');
      const from = Array.isArray(email.from) ? email.from.map(person).join(', ') : person(email.from);
      return clip(`From: ${from}\nDate: ${email.receivedAt ?? ''}\nSubject: ${email.subject ?? ''}\n\n${email.text ?? email.preview ?? ''}`, MAX_TOOL_RESULT);
    }
    case 'check_calendar': {
      const from = DATE_RE.test(args.from ?? '') ? args.from : null;
      let to = DATE_RE.test(args.to ?? '') ? args.to : from;
      if (!from) throw new Error('from must be a date like 2026-05-01');
      if (to < from) to = from;
      if (addDays(from, MAX_CALENDAR_DAYS) < to) to = addDays(from, MAX_CALENDAR_DAYS);
      // `to` of the api is exclusive: the day after the last day.
      const events = (await api.calendar.getEvents({ from, to: addDays(to, 1) })) ?? [];
      return clip(formatEvents(events, { from, to, locale: api.i18n?.getLocale?.() ?? 'en' }), MAX_TOOL_RESULT);
    }
    case 'find_contact': {
      const query = String(args.query ?? '').trim().slice(0, 200);
      if (!query) throw new Error('query is empty');
      const contacts = (await api.contacts.search(query)) ?? [];
      return clip(formatContacts(contacts, query), MAX_TOOL_RESULT);
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
