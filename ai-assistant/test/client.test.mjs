import { describe, it, expect } from 'vitest';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { streamCompletion } from '../src/lib/client.js';
import { ANTHROPIC_EP, OPENAI_EP, anthropicSse, openaiSse, streamResponse } from './helpers.mjs';

const prompt = { system: 's', messages: [{ role: 'user', content: 'Hi' }] };

describe('streamCompletion', () => {
  it('streams an Anthropic answer piece by piece through the admin credential', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => streamResponse(anthropicSse(['Grüß', 'e aus ', 'Köln']), { size: 1 }) } });
    const seen = [];
    const text = await streamCompletion(api, ANTHROPIC_EP, prompt, { onText: (full) => seen.push(full) });
    expect(text).toBe('Grüße aus Köln');
    expect(seen).toEqual(['Grüß', 'Grüße aus ', 'Grüße aus Köln']);
    const [credentialId, url, init] = api.calls('proxy.fetch')[0].args;
    expect(credentialId).toBe('anthropic');
    expect(url).toBe('http://localhost:18099/anthropic/v1/messages');
    expect(init).toMatchObject({ method: 'POST', responseType: 'stream' });
    expect(JSON.parse(init.body)).toMatchObject({ model: 'm', stream: true, messages: prompt.messages });
  });

  it('streams an OpenAI-compatible answer', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => streamResponse(openaiSse(['One ', 'two'])) } });
    expect(await streamCompletion(api, OPENAI_EP, prompt)).toBe('One two');
    expect(api.calls('proxy.fetch')[0].args[1]).toBe('http://localhost:18099/openai/v1/chat/completions');
  });

  it('accepts an answer that came in one piece', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => proxyResponse('{"choices":[{"message":{"content":"Whole"}}]}') } });
    expect(await streamCompletion(api, OPENAI_EP, prompt)).toBe('Whole');
  });

  it('rejects with rate_limit and the wait time on 429', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => proxyResponse('{"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}', { status: 429, headers: { 'retry-after': '7' } }) } });
    await expect(streamCompletion(api, ANTHROPIC_EP, prompt)).rejects.toMatchObject({ code: 'rate_limit', retryAfter: 7 });
  });

  it('rejects with bad_key on 401', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => proxyResponse('{"error":{"code":"invalid_api_key"}}', { status: 401 }) } });
    await expect(streamCompletion(api, OPENAI_EP, prompt)).rejects.toMatchObject({ code: 'bad_key' });
  });

  it('rejects with the service error that arrives mid-stream, keeping the text so far', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => streamResponse(anthropicSse(['Half'], { error: { type: 'overloaded_error', message: 'Overloaded' } })) } });
    await expect(streamCompletion(api, ANTHROPIC_EP, prompt)).rejects.toMatchObject({ code: 'busy', partial: 'Half' });
  });

  it('times out when the service never answers, and cancels the request', async () => {
    let signal;
    const api = fakeApi({ handlers: { 'proxy.fetch': (_c, _u, init) => { signal = init.signal; return new Promise(() => {}); } } });
    await expect(streamCompletion(api, ANTHROPIC_EP, prompt, { firstResponseTimeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
    expect(signal.aborted).toBe(true);
  });

  it('times out when a started answer stalls', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => streamResponse(anthropicSse(['Start']).split('event: content_block_stop')[0], { hang: true, size: 4096 }) } });
    await expect(streamCompletion(api, ANTHROPIC_EP, prompt, { idleTimeoutMs: 40 })).rejects.toMatchObject({ code: 'timeout', partial: 'Start' });
  });

  it('stops when the user cancels, keeping the text so far', async () => {
    const controller = new AbortController();
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => streamResponse(anthropicSse(['First']).split('event: content_block_stop')[0], { hang: true, size: 4096 }) } });
    const run = streamCompletion(api, ANTHROPIC_EP, prompt, {
      signal: controller.signal,
      onText: () => controller.abort(),
    });
    await expect(run).rejects.toMatchObject({ code: 'cancelled', partial: 'First' });
  });

  it('treats an empty answer as an error', async () => {
    const api = fakeApi({ handlers: { 'proxy.fetch': async () => streamResponse(anthropicSse([])) } });
    await expect(streamCompletion(api, ANTHROPIC_EP, prompt)).rejects.toMatchObject({ code: 'empty' });
  });
});
