import { describe, expect, it } from 'vitest';
import { escapeHtml, excerpt, messageLink, taskDescription, taskTitle, textToHtml, webmailBase } from '../src/lib/message.js';
import { priorityFor } from '../src/lib/priority.js';

const t = (key, vars = {}) => `${key}:${Object.values(vars).join('|')}`;

describe('taskTitle', () => {
  it.each([
    ['Re: Invoice October', 'Invoice October'],
    ['AW: WG: Angebot', 'Angebot'],
    ['Fwd: RE: [ext] Contract', '[ext] Contract'],
    ['  Re:Re:   spaced   out  ', 'spaced out'],
    ['Reminder: meeting', 'Reminder: meeting'],
    ['', ''],
  ])('%s', (subject, expected) => {
    expect(taskTitle(subject)).toBe(expected);
  });

  it('cuts long subjects', () => {
    const title = taskTitle('x'.repeat(400));
    expect(title).toHaveLength(250);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('links back to the message', () => {
  it('takes the webmail address from the sandbox page, with its base path', () => {
    expect(webmailBase({ origin: 'https://mail.example.com', pathname: '/plugin-sandbox' })).toBe('https://mail.example.com');
    expect(webmailBase({ origin: 'https://example.com', pathname: '/webmail/plugin-sandbox' })).toBe('https://example.com/webmail');
    expect(webmailBase({ origin: 'null', pathname: '/plugin-sandbox' })).toBe('');
  });

  it('builds the /mail/message/<id> link the app understands', () => {
    expect(messageLink('https://mail.example.com', 'M a/b')).toBe('https://mail.example.com/mail/message/M%20a%2Fb');
  });
});

describe('taskDescription', () => {
  const email = {
    from: [{ name: 'Bob Example', email: 'bob@example.org' }],
    receivedAt: '2026-10-14T09:00:00Z',
    text: 'Please pay the invoice.\n\n> old quoted text\n',
  };

  it('names the sender and date, links the message and quotes its own text', () => {
    const d = taskDescription(email, { link: 'https://m/x', t });
    expect(d).toBe('description.from:Bob Example <bob@example.org>\ndescription.date:2026-10-14T09:00:00Z\ndescription.link:https://m/x\n\nPlease pay the invoice.\n\n> old quoted text');
  });

  it('leaves the text out when asked to', () => {
    expect(taskDescription(email, { link: 'https://m/x', t, withExcerpt: false })).not.toContain('invoice');
  });

  it('shortens long text at a word', () => {
    const long = `${'word '.repeat(300)}end`;
    const out = excerpt(long, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });
});

describe('HTML for Vikunja', () => {
  it('escapes markup and links URLs', () => {
    expect(escapeHtml('<b>"x"&</b>')).toBe('&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;');
    expect(textToHtml('Hi <script>\nsee https://m.example/mail/message/1\n\nBye')).toBe(
      '<p>Hi &lt;script&gt;<br>see <a href="https://m.example/mail/message/1">https://m.example/mail/message/1</a></p><p>Bye</p>',
    );
  });
});

describe('priority', () => {

  it('maps the four levels to each service', () => {
    expect(['none', 'low', 'medium', 'high'].map((p) => priorityFor('bulwark', p))).toEqual([0, 9, 5, 1]);
    expect(['none', 'low', 'medium', 'high'].map((p) => priorityFor('caldav', p))).toEqual([0, 9, 5, 1]);
    expect(['none', 'low', 'medium', 'high'].map((p) => priorityFor('vikunja', p))).toEqual([0, 1, 2, 3]);
    expect(['none', 'low', 'medium', 'high'].map((p) => priorityFor('todoist', p))).toEqual([1, 2, 3, 4]);
  });
});
