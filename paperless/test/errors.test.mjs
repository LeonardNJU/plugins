import { describe, it, expect } from 'vitest';
import { detailOf, errorFromResponse, errorText, toPaperlessError } from '../src/lib/errors.js';

const res = (status, body = '', extra = {}) => ({ status, ok: false, headers: {}, body, ...extra });

describe('errorFromResponse', () => {
  it.each([
    [res(401, '{"detail":"Invalid token."}'), 'error.token'],
    [res(403), 'error.forbidden'],
    [res(404), 'error.not_found'],
    [res(413), 'error.too_large'],
    [res(507), 'error.full'],
    [res(500, 'OSError: [Errno 28] No space left on device'), 'error.full'],
    [res(503), 'error.unavailable'],
    [res(500), 'error.server'],
    [res(400, '{"tags":["Invalid pk"]}'), 'error.rejected'],
  ])('maps HTTP %#', (input, key) => {
    expect(errorFromResponse(input).key).toBe(key);
  });

  it('maps the proxy refusals', () => {
    expect(errorFromResponse(res(404, 'No such credential', { proxyError: 'no_credential' })).key).toBe('error.not_connected');
    expect(errorFromResponse(res(504, '', { proxyError: 'timeout' })).key).toBe('error.timeout');
    expect(errorFromResponse(res(502, '', { proxyError: 'unreachable' })).key).toBe('error.unreachable');
    expect(errorFromResponse(res(403, '', { proxyError: 'blocked_address' })).key).toBe('error.blocked');
  });

  it('passes the wait of a rate limit on', () => {
    const e = errorFromResponse(res(429, '', { proxyError: 'rate_limited', headers: { 'retry-after': '17' } }));
    expect(e).toMatchObject({ key: 'error.rate_limit', vars: { seconds: 17 } });
    expect(errorFromResponse(res(429)).vars.seconds).toBe(60);
  });
});

describe('detailOf', () => {
  it('reads Django REST error shapes and skips HTML', () => {
    expect(detailOf('{"detail":"Nope."}')).toBe('Nope.');
    expect(detailOf({ title: ['Too long.'], non_field_errors: ['Bad.'] })).toBe('title: Too long.; Bad.');
    expect(detailOf('<!DOCTYPE html><html>500</html>')).toBe('');
  });
});

describe('toPaperlessError', () => {
  it('turns host errors into plain messages, never a stack', () => {
    expect(toPaperlessError(new Error('API call proxy.fetch timed out after 30s')).key).toBe('error.timeout');
    expect(toPaperlessError(new Error('email.getAttachment: it is larger than 26214400 bytes')).key).toBe('error.too_large');
    const t = (key, vars) => `${key}|${JSON.stringify(vars)}`;
    expect(errorText(t, new Error('boom\n    at x (y.js:1)'))).toBe('error.unexpected|{"detail":"boom"}');
  });
});
