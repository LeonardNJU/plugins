// Errors from Nextcloud and from the webmail's proxy, turned into a few
// codes the user gets a plain sentence for. Never a stack trace.

export class NcError extends Error {
  /**
   * @param {string} code one of ERROR_CODES
   * @param {{ status?: number, detail?: string }} [info]
   */
  constructor(code, info = {}) {
    super(info.detail ? `${code}: ${info.detail}` : code);
    this.name = 'NcError';
    this.code = code;
    this.status = info.status ?? 0;
    this.detail = info.detail ?? '';
  }
}

export const ERROR_CODES = [
  'not_connected', 'auth', 'forbidden', 'share_forbidden', 'not_found', 'exists', 'quota', 'too_large',
  'locked', 'rate_limited', 'timeout', 'unreachable', 'blocked', 'maintenance', 'server', 'cancelled',
  'wrong_server', 'login_expired', 'bad_answer', 'rejected', 'attach_refused', 'unknown',
];

// The proxy marks its own refusals with x-bulwark-proxy-error.
const PROXY_CODES = {
  no_credential: 'not_connected',
  rate_limited: 'rate_limited',
  timeout: 'timeout',
  unreachable: 'unreachable',
  blocked_address: 'blocked',
  wrong_origin: 'blocked',
  redirect_off_origin: 'blocked',
  too_large: 'too_large',
};

/** The message an OCS answer carries, if any. */
export function ocsMessage(body) {
  let data = body;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return ''; }
  }
  const message = data?.ocs?.meta?.message;
  return typeof message === 'string' && message !== 'OK' ? message : '';
}

/** A WebDAV error answer's <s:message>, if any. */
export function davMessage(body) {
  if (typeof body !== 'string') return '';
  const m = /<(?:[\w.-]+:)?message>([^<]{1,300})<\//.exec(body);
  return m ? m[1].trim() : '';
}

/**
 * The error for a proxy.fetch result, or null when it went through.
 * `kind` "share" turns a 403 into share_forbidden.
 */
export function errorFromResponse(res, { kind } = {}) {
  if (!res || typeof res !== 'object') return new NcError('unknown');
  if (res.proxyError) {
    return new NcError(PROXY_CODES[res.proxyError] ?? 'unknown', { status: res.status, detail: typeof res.body === 'string' ? res.body : '' });
  }
  if (res.ok) return null;
  const status = Number(res.status) || 0;
  const detail = ocsMessage(res.body) || davMessage(res.body);
  const info = { status, detail };
  if (status === 400 && detail) return new NcError('rejected', info);
  if (status === 401) return new NcError('auth', info);
  if (status === 403) return new NcError(kind === 'share' ? 'share_forbidden' : 'forbidden', info);
  if (status === 404) return new NcError('not_found', info);
  if (status === 405 || status === 412) return new NcError('exists', info);
  if (status === 413) return new NcError('too_large', info);
  if (status === 423) return new NcError('locked', info);
  if (status === 429) return new NcError('rate_limited', info);
  if (status === 503) return new NcError('maintenance', info);
  if (status === 507) return new NcError('quota', info);
  if (status === 504 || status === 408) return new NcError('timeout', info);
  if (status >= 500) return new NcError('server', info);
  return new NcError('unknown', info);
}

/** An exception thrown by api.proxy.fetch itself (the host refused or the request broke). */
export function errorFromException(err, signal) {
  if (err instanceof NcError) return err;
  if (signal?.aborted) return new NcError('cancelled');
  const message = String(err?.message ?? err ?? '');
  if (/cancel|abort/i.test(message)) return new NcError('cancelled');
  if (/timed out/i.test(message)) return new NcError('timeout');
  if (/larger than/i.test(message)) return new NcError('too_large');
  if (/at most \d+ proxy requests/i.test(message)) return new NcError('rate_limited');
  if (/network/i.test(message)) return new NcError('unreachable');
  return new NcError('unknown', { detail: message.slice(0, 200) });
}

/** Whether the user should be offered to sign in again. */
export function needsSignIn(err) {
  return err instanceof NcError && (err.code === 'auth' || err.code === 'not_connected' || err.code === 'wrong_server');
}

/**
 * One sentence for the user. `t` is api.i18n.t. Nextcloud's own message is
 * added for errors where it says something useful (password rules, sharing
 * turned off by the admin).
 */
export function errorText(t, err) {
  const e = err instanceof NcError ? err : errorFromException(err);
  const text = t(`error.${ERROR_CODES.includes(e.code) ? e.code : 'unknown'}`);
  const withDetail = ['forbidden', 'share_forbidden', 'rejected', 'unknown', 'bad_answer'].includes(e.code) && e.detail;
  return withDetail ? `${text} (${e.detail})` : text;
}
