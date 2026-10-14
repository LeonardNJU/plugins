// A VTODO as iCalendar text (RFC 5545), for CalDAV task lists.

/** Escape a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * @param {{ uid: string, title: string, description?: string, due?: string|null,
 *   priority?: number, url?: string|null, now?: Date }} task
 */
export function buildVtodo({ uid, title, description, due, priority, url, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bulwark//Email to task//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `CREATED:${utcStamp(now)}`,
    `SUMMARY:${escapeText(title)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) lines.push(`DUE;VALUE=DATE:${due.replace(/-/g, '')}`);
  if (priority) lines.push(`PRIORITY:${priority}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('STATUS:NEEDS-ACTION', 'END:VTODO', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
