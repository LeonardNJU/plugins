import { describe, expect, it } from 'vitest';
import { buildVtodo, escapeText, foldLine } from '../src/lib/ical.js';
import { hrefIn, isTaskList, multistatus, parseXml } from '../src/lib/dav-xml.js';

describe('iCalendar VTODO', () => {
  it('escapes text values', () => {
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `SUMMARY:${'ä'.repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });

  it('keeps continuation lines, with their leading space, within 75 octets', () => {
    const parts = foldLine(`DESCRIPTION:${'x'.repeat(300)}`).split(String.fromCharCode(13, 10));
    expect(parts[0]).toHaveLength(75);
    for (const p of parts.slice(1, -1)) expect(p).toHaveLength(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
  });

  it('writes a task with a date-only due date, priority and link', () => {
    const ics = buildVtodo({
      uid: 'u1', title: 'Pay, now; please', description: 'line 1\nline 2', due: '2026-10-20', priority: 1,
      url: 'https://mail.example/mail/message/M1', now: new Date('2026-10-14T08:09:10.123Z'),
    });
    const lines = ics.split('\r\n');
    expect(lines).toContain('BEGIN:VTODO');
    expect(lines).toContain('UID:u1');
    expect(lines).toContain('DTSTAMP:20261014T080910Z');
    expect(lines).toContain('SUMMARY:Pay\\, now\\; please');
    expect(lines).toContain('DESCRIPTION:line 1\\nline 2');
    expect(lines).toContain('DUE;VALUE=DATE:20261020');
    expect(lines).toContain('PRIORITY:1');
    expect(lines).toContain('URL:https://mail.example/mail/message/M1');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('leaves out what is not set', () => {
    const ics = buildVtodo({ uid: 'u2', title: 'x', due: null, priority: 0 });
    expect(ics).not.toMatch(/DUE|PRIORITY|DESCRIPTION|URL:/);
  });
});

// Stalwart's answer for alice's calendar home, shortened.
const HOME = `<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:" xmlns:A="urn:ietf:params:xml:ns:caldav">
<D:response><D:href>/dav/cal/alice%40example.org/</D:href><D:propstat><D:prop><A:supported-calendar-component-set/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:displayname>alice</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response><D:href>/dav/cal/alice%40example.org/tasks/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><A:calendar/></D:resourcetype><D:displayname>Tasks &amp; to-dos</D:displayname><A:supported-calendar-component-set><A:comp name="VTODO"/></A:supported-calendar-component-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response><D:href>/dav/cal/alice%40example.org/events/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><A:calendar/></D:resourcetype><A:supported-calendar-component-set><A:comp name="VEVENT"/></A:supported-calendar-component-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
</D:multistatus>`;

describe('WebDAV multistatus', () => {
  it('reads responses with any namespace prefix and only 2xx properties', () => {
    const r = multistatus(HOME);
    expect(r.map((x) => x.href)).toEqual(['/dav/cal/alice%40example.org/', '/dav/cal/alice%40example.org/tasks/', '/dav/cal/alice%40example.org/events/']);
    expect(r[0].props['supported-calendar-component-set']).toBeUndefined();
    expect(r[1].props.displayname.text).toBe('Tasks & to-dos');
  });

  it('knows which collections take tasks', () => {
    const r = multistatus(HOME);
    expect(r.map((x) => isTaskList(x.props))).toEqual([false, true, false]);
  });

  it('treats a calendar without a component set as taking tasks', () => {
    const [r] = multistatus('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/c/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>');
    expect(isTaskList(r.props)).toBe(true);
  });

  it('finds hrefs inside properties', () => {
    const [r] = multistatus('<multistatus xmlns="DAV:"><response><href>/dav/cal/</href><propstat><prop><current-user-principal><href>/dav/pal/alice/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>');
    expect(hrefIn(r.props['current-user-principal'])).toBe('/dav/pal/alice/');
  });

  it('rejects broken XML and returns nothing for other documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
    expect(multistatus('<html><body>hi</body></html>')).toEqual([]);
  });
});
