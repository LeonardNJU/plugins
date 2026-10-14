// One streamed completion through the webmail's proxy (api.proxy.fetch),
// with cancel and timeouts. The proxy adds the API key on the server.

import { buildRequest, deltaFromEvent, textFromResponse } from './providers.js';
import { createSseParser } from './sse.js';
import { AiError, errorFromResponse, errorFromStream } from './errors.js';

/** No answer at all after this long: give up. */
export const FIRST_RESPONSE_TIMEOUT_MS = 60_000;
/** Nothing new in a running answer for this long: give up. */
export const IDLE_TIMEOUT_MS = 60_000;

function isStream(body) {
  return body && typeof body === 'object' && typeof body.getReader === 'function';
}

/**
 * Ask for a completion and stream the answer.
 *
 * onText(fullText, delta) is called for every piece. Resolves to the whole
 * answer. Rejects with an AiError: `cancelled` when `signal` aborts (the
 * text so far is in error.partial), `timeout`, or what the service said.
 */
export async function streamCompletion(api, endpoint, prompt, {
  onText = () => {},
  signal,
  firstResponseTimeoutMs = FIRST_RESPONSE_TIMEOUT_MS,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
} = {}) {
  if (signal?.aborted) throw new AiError('cancelled');
  const request = buildRequest(endpoint, prompt, { stream: true });
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  let text = '';

  let stopWaiting;
  const stopped = new Promise((_, reject) => { stopWaiting = reject; });
  stopped.catch(() => {});
  const fail = () => {
    stopWaiting(new AiError(timedOut ? 'timeout' : 'cancelled', { partial: text }));
  };
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      fail();
    }, ms);
  };
  const onAbort = () => {
    controller.abort();
    fail();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    arm(firstResponseTimeoutMs);
    let res;
    try {
      res = await Promise.race([
        api.proxy.fetch(endpoint.credentialId, request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          responseType: 'stream',
          signal: controller.signal,
        }),
        stopped,
      ]);
    } catch (err) {
      if (err instanceof AiError) throw err;
      throw new AiError('unreachable', { detail: err?.message });
    }
    if (!res || !res.ok) throw errorFromResponse(res);

    const emit = (piece) => {
      if (!piece) return;
      text += piece;
      onText(text, piece);
    };
    const parser = createSseParser();
    const handle = (events) => {
      for (const ev of events) {
        const delta = deltaFromEvent(endpoint.provider, ev);
        if (delta.error) throw errorFromStream(delta.error, text);
        if (delta.text) emit(delta.text);
        if (delta.done) return true;
      }
      return false;
    };

    if (!isStream(res.body)) {
      // A host or server that answered in one piece.
      const body = typeof res.body === 'string' ? res.body : '';
      const trimmed = body.trim();
      if (trimmed.startsWith('{')) {
        try {
          emit(textFromResponse(endpoint.provider, JSON.parse(trimmed)));
        } catch {
          throw new AiError('server', { detail: 'unreadable answer' });
        }
      } else {
        handle([...parser.feed(body), ...parser.end()]);
      }
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          arm(idleTimeoutMs);
          const { done, value } = await Promise.race([reader.read(), stopped]);
          if (done) {
            handle([...parser.feed(decoder.decode()), ...parser.end()]);
            break;
          }
          if (handle(parser.feed(decoder.decode(value, { stream: true })))) break;
        }
      } catch (err) {
        if (err instanceof AiError) {
          if (err.code === 'cancelled' || err.code === 'timeout') err.partial = text;
          throw err;
        }
        // The stream broke: the proxy cancelled it or the connection dropped.
        if (signal?.aborted) throw new AiError('cancelled', { partial: text });
        throw new AiError(timedOut ? 'timeout' : 'unreachable', { detail: err?.message, partial: text });
      } finally {
        reader.cancel().catch(() => {});
      }
    }
    if (!text.trim()) throw new AiError('empty');
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
