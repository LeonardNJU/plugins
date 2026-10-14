// The two API shapes the assistant speaks: OpenAI-compatible chat
// completions (OpenAI, Ollama, LM Studio, vLLM, ...) and the Anthropic
// Messages API. The API key is never here: the webmail's server adds it.

export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * The HTTP request for one completion.
 * endpoint: from resolveEndpoint; prompt: { system, messages, maxTokens }.
 */
export function buildRequest(endpoint, prompt, { stream = true } = {}) {
  const messages = prompt.messages ?? [];
  const maxTokens = prompt.maxTokens ?? 1500;
  if (endpoint.provider === 'anthropic') {
    return {
      url: `${endpoint.baseUrl}/messages`,
      headers: {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        accept: stream ? 'text/event-stream' : 'application/json',
      },
      body: {
        model: endpoint.model,
        max_tokens: maxTokens,
        ...(prompt.system ? { system: prompt.system } : {}),
        messages,
        stream,
      },
    };
  }
  return {
    url: `${endpoint.baseUrl}/chat/completions`,
    headers: {
      'content-type': 'application/json',
      accept: stream ? 'text/event-stream' : 'application/json',
    },
    body: {
      model: endpoint.model,
      messages: prompt.system ? [{ role: 'system', content: prompt.system }, ...messages] : messages,
      stream,
    },
  };
}

/** The answer text of a non-streamed response body. */
export function textFromResponse(provider, json) {
  if (!json || typeof json !== 'object') return '';
  if (provider === 'anthropic') {
    const blocks = Array.isArray(json.content) ? json.content : [];
    return blocks.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('');
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  return choice?.message?.content ?? '';
}

function parse(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * What one server-sent event means: { text } for a piece of the answer,
 * { done: true } at the end, { error: { type, message } } when the service
 * failed mid-answer, or {} for events that carry nothing for us.
 */
export function deltaFromEvent(provider, { event, data }) {
  if (provider === 'anthropic') {
    const json = parse(data);
    const type = json?.type ?? event;
    if (type === 'content_block_delta' && json?.delta?.type === 'text_delta') return { text: json.delta.text ?? '' };
    if (type === 'message_stop') return { done: true };
    if (type === 'error') {
      return { error: { type: json?.error?.type ?? 'api_error', message: json?.error?.message ?? '' } };
    }
    return {};
  }
  if (data.trim() === '[DONE]') return { done: true };
  const json = parse(data);
  if (!json) return {};
  if (json.error) {
    const err = typeof json.error === 'object' ? json.error : { message: String(json.error) };
    return { error: { type: err.code ?? err.type ?? 'api_error', message: err.message ?? '' } };
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const text = choice?.delta?.content;
  return typeof text === 'string' && text ? { text } : {};
}
