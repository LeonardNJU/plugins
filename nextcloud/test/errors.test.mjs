import { describe, it, expect } from 'vitest';
import { NcError, errorFromResponse, errorFromException, errorText, needsSignIn, ERROR_CODES } from '../src/lib/errors.js';
import en from '../locales/en.json' with { type: 'json' };

const t = (key) => en[key] ?? key;
const res = (status, body = '', extra = {}) => ({ status, ok: status >= 200 && status < 300, headers: {}, body, ...extra });

describe('errors', () => {
  it('maps Nextcloud status codes to plain errors', () => {
    expect(errorFromResponse(res(200))).toBeNull();
    expect(errorFromResponse(res(401)).code).toBe('auth');
    expect(errorFromResponse(res(403)).code).toBe('forbidden');
    expect(errorFromResponse(res(403), { kind: 'share' }).code).toBe('share_forbidden');
    expect(errorFromResponse(res(404)).code).toBe('not_found');
    expect(errorFromResponse(res(423)).code).toBe('locked');
    expect(errorFromResponse(res(429)).code).toBe('rate_limited');
    expect(errorFromResponse(res(503)).code).toBe('maintenance');
    expect(errorFromResponse(res(507)).code).toBe('quota');
    expect(errorFromResponse(res(500)).code).toBe('server');
  });

  it('tells the proxy refusing from the server refusing', () => {
    expect(errorFromResponse(res(404, 'No such credential', { proxyError: 'no_credential' })).code).toBe('not_connected');
    expect(errorFromResponse(res(429, '', { proxyError: 'rate_limited' })).code).toBe('rate_limited');
    expect(errorFromResponse(res(504, '', { proxyError: 'timeout' })).code).toBe('timeout');
    expect(errorFromResponse(res(403, '', { proxyError: 'blocked_address' })).code).toBe('blocked');
  });

  it('keeps Nextcloud\'s own message for refusals', () => {
    const body = JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 400, message: 'Password needs to be at least 10 characters long.' } } });
    const err = errorFromResponse(res(400, body));
    expect(err.code).toBe('rejected');
    expect(errorText(t, err)).toBe('Nextcloud refused this. (Password needs to be at least 10 characters long.)');
    const dav = '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns"><s:exception>X</s:exception><s:message>Insufficient space in /</s:message></d:error>';
    expect(errorFromResponse(res(507, dav)).detail).toBe('Insufficient space in /');
  });

  it('gives a sentence, not a stack trace, for host exceptions', () => {
    expect(errorFromException(new Error('API call proxy.fetch timed out after 30s')).code).toBe('timeout');
    expect(errorFromException(new Error('Network error')).code).toBe('unreachable');
    expect(errorFromException(new Error('At most 8 proxy requests at once')).code).toBe('rate_limited');
    const ctrl = new AbortController();
    ctrl.abort();
    expect(errorFromException(new Error('whatever'), ctrl.signal).code).toBe('cancelled');
    expect(errorText(t, new TypeError('x is undefined'))).toBe('Something went wrong with Nextcloud. (x is undefined)');
  });

  it('offers to sign in again only for sign-in problems', () => {
    expect(needsSignIn(new NcError('auth'))).toBe(true);
    expect(needsSignIn(new NcError('not_connected'))).toBe(true);
    expect(needsSignIn(new NcError('quota'))).toBe(false);
    expect(errorText(t, new NcError('quota'))).toBe(en['error.quota']);
  });

  it('has an English sentence for every code', () => {
    for (const code of ERROR_CODES) expect(en[`error.${code}`], code).toBeTypeOf('string');
  });
});
