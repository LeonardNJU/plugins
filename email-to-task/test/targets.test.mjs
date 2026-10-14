import { describe, expect, it } from 'vitest';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { vikunja } from '../src/lib/targets/vikunja.js';
import { errorForResponse, errorText, request, toTaskError } from '../src/lib/errors.js';

const TASK = { title: 'Pay invoice', description: 'From: Bob\nOpen the message: https://m/mail/message/M1', due: '2026-10-20', priority: 'high', containerId: '2', link: 'https://m/mail/message/M1' };

function proxyApi(route) {
  return fakeApi({ handlers: { 'proxy.fetch': async (id, url, init = {}) => route(id, url, init) } });
}

describe('Vikunja', () => {
  const ctx = (api, config = {}) => ({ api, origin: 'http://localhost:18456', config: { vikunjaUrl: '', ...config } });

  it('lists projects a task can go into, skipping saved filters and archived ones', async () => {
    const api = proxyApi((id, url) => {
      expect(id).toBe('vikunja');
      expect(url).toBe('http://localhost:18456/api/v1/projects?page=1&per_page=50');
      return proxyResponse([{ id: 1, title: 'Inbox' }, { id: 2, title: 'Bulwark inbox' }, { id: -2, title: 'My Open Tasks' }, { id: 3, title: 'Old', is_archived: true }]);
    });
    expect(await vikunja.containers(ctx(api))).toEqual([{ id: '1', name: 'Inbox' }, { id: '2', name: 'Bulwark inbox' }]);
  });

  it('creates the task with PUT, HTML description, priority and a noon due date', async () => {
    let sent;
    const api = proxyApi((id, url, init) => {
      sent = { url, init };
      return proxyResponse({ id: 42, title: 'Pay invoice' });
    });
    const out = await vikunja.create(ctx(api, { vikunjaUrl: 'http://localhost:18456/' }), TASK);
    expect(sent.url).toBe('http://localhost:18456/api/v1/projects/2/tasks');
    expect(sent.init.method).toBe('PUT');
    const body = JSON.parse(sent.init.body);
    expect(body.title).toBe('Pay invoice');
    expect(body.priority).toBe(3);
    expect(new Date(body.due_date).getHours()).toBe(12);
    expect(body.description).toContain('<a href="https://m/mail/message/M1">');
    expect(out).toEqual({ taskId: '42', url: 'http://localhost:18456/tasks/42' });
  });

  it('uses the sub-path of the administrator\'s address on the same server', async () => {
    let url;
    const api = proxyApi((id, u) => { url = u; return proxyResponse({ id: 1 }); });
    const out = await vikunja.create({ api, origin: 'https://example.com', config: { vikunjaUrl: 'https://example.com/vikunja/' } }, TASK);
    expect(url).toBe('https://example.com/vikunja/api/v1/projects/2/tasks');
    expect(out.url).toBe('https://example.com/vikunja/tasks/1');
  });

  it('needs a project', async () => {
    await expect(vikunja.create(ctx(proxyApi(() => proxyResponse({}))), { ...TASK, containerId: '' })).rejects.toMatchObject({ code: 'no_project' });
  });

  it('tells deleted tasks from unreachable servers', async () => {
    expect(await vikunja.exists(ctx(proxyApi(() => proxyResponse({ message: 'nope' }, { status: 404 }))), { taskId: '1' })).toBe(false);
    expect(await vikunja.exists(ctx(proxyApi(() => proxyResponse('', { status: 502 }))), { taskId: '1' })).toBeNull();
    expect(await vikunja.exists(ctx(proxyApi(() => proxyResponse({ id: 1 }))), { taskId: '1' })).toBe(true);
  });
});




describe('errors', () => {
  it.each([
    [401, 'auth'], [403, 'forbidden'], [404, 'not_found'], [412, 'conflict'], [413, 'too_large'],
    [429, 'rate_limited'], [507, 'quota'], [504, 'timeout'], [400, 'bad_request'], [500, 'server'],
  ])('HTTP %i is %s', (status, code) => {
    expect(errorForResponse({ status, ok: false, headers: {} }).code).toBe(code);
  });

  it('tells the proxy\'s own refusals from the server\'s answers', () => {
    expect(errorForResponse({ status: 404, ok: false, headers: {}, proxyError: 'no_credential' }).code).toBe('not_connected');
    expect(errorForResponse({ status: 429, ok: false, headers: { 'retry-after': '12' }, proxyError: 'rate_limited' })).toMatchObject({ code: 'rate_limited', retryAfter: 12 });
    expect(errorForResponse({ status: 403, ok: false, headers: {}, proxyError: 'blocked_address' }).code).toBe('blocked');
    expect(errorForResponse({ status: 504, ok: false, headers: {}, proxyError: 'timeout' }).code).toBe('timeout');
  });

  it('maps thrown host errors', () => {
    expect(toTaskError(new Error('API call proxy.fetch timed out after 30s')).code).toBe('timeout');
    expect(toTaskError(new Error('Plugin "x" lacks permission "tasks:write"')).code).toBe('permission');
  });

  it('gives plain words, never the raw error', async () => {
    const t = (key, vars) => `${key} ${JSON.stringify(vars)}`;
    const api = proxyApi(() => { throw new Error('TypeError: x is undefined at foo.js:1'); });
    const err = await request(api, 'vikunja', 'https://x/').catch((e) => e);
    expect(errorText(t, err, 'Vikunja')).toBe('error.unknown {"service":"Vikunja","seconds":60}');
    expect(errorText(t, errorForResponse({ status: 429, ok: false, headers: {} }), 'Todoist')).toMatch(/^error\.rate_limited_later/);
  });
});
