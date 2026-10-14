// Turns what went wrong talking to Paperless into a message key the user can
// read: an expired token, a missing permission, a full disk, a rate limit, a
// timeout. Never a stack trace or an HTTP dump.

export class PaperlessError extends Error {
  /**
   * @param {string} key  i18n key, e.g. 'error.token'
   * @param {Record<string, string|number>} [vars]
   * @param {number} [status] HTTP status, when there was one
   */
  constructor(key, vars = {}, status = 0) {
    super(key);
    this.name = 'PaperlessError';
    this.key = key;
    this.vars = vars;
    this.status = status;
  }
}

/** Short, single-line text from a Paperless error body ({detail}, {field: [msg]}, or a string). */
export function detailOf(body) {
  if (body == null) return '';
  if (typeof body === 'string') {
    const text = body.trim();
    if (/^[{[]/.test(text)) {
      try { return detailOf(JSON.parse(text)); } catch { /* not JSON after all */ }
    }
    // An HTML error page says nothing useful to a user.
    if (/^<(!doctype|html)/i.test(text)) return '';
    return oneLine(text);
  }
  if (typeof body === 'object') {
    if (typeof body.detail === 'string') return oneLine(body.detail);
    if (typeof body.error === 'string') return oneLine(body.error);
    const parts = [];
    for (const [field, value] of Object.entries(body)) {
      const msg = Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(' ') : (typeof value === 'string' ? value : '');
      if (msg) parts.push(field === 'non_field_errors' ? msg : `${field}: ${msg}`);
    }
    return oneLine(parts.join('; '));
  }
  return '';
}

function oneLine(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 197)}...` : flat;
}

function retryAfter(headers) {
  const raw = headers?.['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
}

/** A PaperlessError for a proxy result that was not ok. */
export function errorFromResponse(res) {
  if (res.proxyError) {
    switch (res.proxyError) {
      case 'no_credential': return new PaperlessError('error.not_connected', {}, res.status);
      case 'rate_limited': return new PaperlessError('error.rate_limit', { seconds: retryAfter(res.headers) || 60 }, 429);
      case 'timeout': return new PaperlessError('error.timeout', {}, 504);
      case 'unreachable': return new PaperlessError('error.unreachable', {}, 502);
      case 'blocked_address': return new PaperlessError('error.blocked', {}, 403);
      case 'too_large': return new PaperlessError('error.too_large', {}, 413);
      case 'wrong_origin': return new PaperlessError('error.wrong_server', {}, 403);
      default: return new PaperlessError('error.proxy', { detail: detailOf(res.body) }, res.status);
    }
  }
  const status = res.status;
  const detail = detailOf(res.body);
  if (status === 401) return new PaperlessError('error.token', {}, status);
  if (status === 403) return new PaperlessError('error.forbidden', {}, status);
  if (status === 404) return new PaperlessError('error.not_found', {}, status);
  if (status === 413) return new PaperlessError('error.too_large', {}, status);
  if (status === 429) return new PaperlessError('error.rate_limit', { seconds: retryAfter(res.headers) || 60 }, status);
  if (status === 507 || /no space left|disk (is )?full|quota/i.test(detail)) return new PaperlessError('error.full', {}, status);
  if (status === 502 || status === 503 || status === 504) return new PaperlessError('error.unavailable', {}, status);
  if (status >= 500) return new PaperlessError('error.server', {}, status);
  if (status >= 400) return new PaperlessError('error.rejected', { detail: detail || `HTTP ${status}` }, status);
  return new PaperlessError('error.unexpected', { detail: `HTTP ${status}` }, status);
}

/** Any thrown value as a PaperlessError (host API failures, timeouts, bugs). */
export function toPaperlessError(err) {
  if (err instanceof PaperlessError) return err;
  const message = err && typeof err.message === 'string' ? err.message : String(err);
  if (/timed out|timeout/i.test(message)) return new PaperlessError('error.timeout');
  if (/cancel|abort/i.test(message)) return new PaperlessError('error.cancelled');
  if (/larger than/i.test(message)) return new PaperlessError('error.too_large');
  if (/permission|not allowed|not granted/i.test(message)) return new PaperlessError('error.permission');
  if (/network|failed to fetch/i.test(message)) return new PaperlessError('error.unreachable');
  // First line only: a stack trace is no use to the user.
  return new PaperlessError('error.unexpected', { detail: oneLine(message.split(/\r?\n/)[0]) });
}

/** The message for an error, in the user's language. */
export function errorText(t, err) {
  const e = toPaperlessError(err);
  return t(e.key, e.vars);
}
