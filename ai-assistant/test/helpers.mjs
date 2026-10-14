// Fake streamed answers for the client and UI-logic tests.

export const ANTHROPIC_EP = { provider: 'anthropic', credentialId: 'anthropic', baseUrl: 'http://localhost:18099/anthropic/v1', origin: 'http://localhost:18099', model: 'm', own: false };
export const OPENAI_EP = { provider: 'openai', credentialId: 'openai', baseUrl: 'http://localhost:18099/openai/v1', origin: 'http://localhost:18099', model: 'm', own: false };

export function anthropicSse(pieces, { error } = {}) {
  const ev = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let out = ev('message_start', { type: 'message_start', message: { id: 'x' } });
  out += ev('content_block_start', { type: 'content_block_start', index: 0 });
  out += ev('ping', { type: 'ping' });
  for (const text of pieces) out += ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  if (error) return out + ev('error', { type: 'error', error });
  out += ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  out += ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' } });
  out += ev('message_stop', { type: 'message_stop' });
  return out;
}

export function openaiSse(pieces) {
  let out = `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`;
  for (const content of pieces) out += `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  out += `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`;
  return `${out}data: [DONE]\n\n`;
}

/** A ReadableStream that hands out the text in chunks of `size` bytes (splitting characters too). */
export function byteStream(text, { size = 7, hang = false } = {}) {
  const bytes = new TextEncoder().encode(text);
  let pos = 0;
  return new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) {
        if (!hang) controller.close();
        return hang ? new Promise(() => {}) : undefined;
      }
      controller.enqueue(bytes.slice(pos, pos + size));
      pos += size;
      return undefined;
    },
  });
}

export function streamResponse(text, opts) {
  return { status: 200, ok: true, headers: { 'content-type': 'text/event-stream' }, body: byteStream(text, opts) };
}
