// Turning failed requests into something a person can act on.

export class TaskError extends Error {
  /**
   * @param {string} code one of the `error.<code>` translation keys
   * @param {{ status?: number, retryAfter?: number, detail?: string }} info
   */
  constructor(code, info = {}) {
    super(info.detail ? `${code}: ${info.detail}` : code);
    this.name = 'TaskError';
    this.code = code;
    this.status = info.status;
    this.retryAfter = info.retryAfter;
  }
}

/** Codes after which the account should be connected (again). */
export const RECONNECT_CODES = new Set(['auth', 'not_connected']);

const PROXY_CODES = {
  no_credential: 'not_connected',
  rate_limited: 'rate_limited',
  timeout: 'timeout',
  unreachable: 'unreachable',
  blocked_address: 'blocked',
  wrong_origin: 'wrong_server',
  redirect_off_origin: 'wrong_server',
  too_large: 'too_large',
};

function retryAfterOf(headers) {
  const raw = headers?.['retry-after'];
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(1, Math.round(seconds));
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(1, Math.round((when - Date.now()) / 1000)) : undefined;
}

/** The error code for an HTTP answer that is not ok. */
export function codeForStatus(status) {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 507) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 400 || status === 422) return 'bad_request';
  return 'server';
}

/** A TaskError for a proxy.fetch result that is not ok. */
export function errorForResponse(res) {
  if (res.proxyError) {
    return new TaskError(PROXY_CODES[res.proxyError] ?? 'server', {
      status: res.status,
      retryAfter: retryAfterOf(res.headers),
      detail: typeof res.body === 'string' ? res.body : res.proxyError,
    });
  }
  return new TaskError(codeForStatus(res.status), {
    status: res.status,
    retryAfter: retryAfterOf(res.headers),
  });
}

/** A TaskError for anything thrown on the way (host refused, timed out, ...). */
export function toTaskError(err) {
  if (err instanceof TaskError) return err;
  const message = String(err?.message ?? err ?? '');
  if (/timed out/i.test(message)) return new TaskError('timeout', { detail: message });
  if (/lacks permission/i.test(message)) return new TaskError('permission', { detail: message });
  if (/no calendar to put it in|no active session/i.test(message)) return new TaskError('no_task_list', { detail: message });
  if (/network|failed to fetch/i.test(message)) return new TaskError('unreachable', { detail: message });
  return new TaskError('unknown', { detail: message });
}

/** The words for an error, through the plugin's translations. */
export function errorText(t, err, service) {
  const e = toTaskError(err);
  const vars = { service: service ?? '', seconds: e.retryAfter ?? 60 };
  if (e.code === 'rate_limited' && !e.retryAfter) return t('error.rate_limited_later', vars);
  return t(`error.${e.code}`, vars);
}

/** proxy.fetch that throws a TaskError unless the answer is ok. */
export async function request(api, credentialId, url, init = {}) {
  let res;
  try {
    res = await api.proxy.fetch(credentialId, url, init);
  } catch (err) {
    throw toTaskError(err);
  }
  if (!res || !res.ok) throw errorForResponse(res ?? { status: 0 });
  return res;
}
