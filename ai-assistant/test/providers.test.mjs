import { describe, it, expect } from 'vitest';
import { createSseParser } from '../src/lib/sse.js';
import { buildRequest, deltaFromEvent, textFromResponse } from '../src/lib/providers.js';

const anthropic = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5' };
const openai = { provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:0.5b' };
const prompt = { system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 300 };

describe('createSseParser', () => {
  it('handles events split across chunks, CRLF and multi-line data', () => {
    const p = createSseParser();
    expect(p.feed('event: content_block_delta\r\ndata: {"a"')).toEqual([]);
    expect(p.feed(':1}\r\n\r')).toEqual([]);
    expect(p.feed('\ndata: one\ndata: two\n\n: comment\n')).toEqual([
      { event: 'content_block_delta', data: '{"a":1}' },
      { event: 'message', data: 'one\ntwo' },
    ]);
    expect(p.feed('data: [DONE]')).toEqual([]);
    expect(p.end()).toEqual([{ event: 'message', data: '[DONE]' }]);
  });
});

describe('buildRequest', () => {
  it('builds an Anthropic Messages request with version header and no key', () => {
    const r = buildRequest(anthropic, prompt);
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.headers).not.toHaveProperty('x-api-key');
    expect(r.body).toEqual({ model: 'claude-haiku-4-5', max_tokens: 300, system: 'Be brief.', messages: prompt.messages, stream: true });
  });

  it('builds an OpenAI chat completion with the system prompt as the first message', () => {
    const r = buildRequest(openai, prompt, { stream: false });
    expect(r.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(r.headers).not.toHaveProperty('authorization');
    expect(r.body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
    expect(r.body.messages[1]).toEqual({ role: 'user', content: 'Hi' });
    expect(r.body.stream).toBe(false);
  });
});

describe('deltaFromEvent', () => {
  it('reads Anthropic text deltas, the end and errors', () => {
    expect(deltaFromEvent('anthropic', { event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}' })).toEqual({ text: 'Hel' });
    expect(deltaFromEvent('anthropic', { event: 'ping', data: '{"type":"ping"}' })).toEqual({});
    expect(deltaFromEvent('anthropic', { event: 'message_stop', data: '{"type":"message_stop"}' })).toEqual({ done: true });
    expect(deltaFromEvent('anthropic', { event: 'error', data: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }))
      .toEqual({ error: { type: 'overloaded_error', message: 'Overloaded' } });
  });

  it('reads OpenAI chunks, [DONE] and errors', () => {
    expect(deltaFromEvent('openai', { event: 'message', data: '{"choices":[{"delta":{"role":"assistant"}}]}' })).toEqual({});
    expect(deltaFromEvent('openai', { event: 'message', data: '{"choices":[{"delta":{"content":"lo"}}]}' })).toEqual({ text: 'lo' });
    expect(deltaFromEvent('openai', { event: 'message', data: '[DONE]' })).toEqual({ done: true });
    expect(deltaFromEvent('openai', { event: 'message', data: '{"error":{"code":"rate_limit_exceeded","message":"slow down"}}' }))
      .toEqual({ error: { type: 'rate_limit_exceeded', message: 'slow down' } });
  });
});

describe('textFromResponse', () => {
  it('reads both non-streamed shapes', () => {
    expect(textFromResponse('anthropic', { content: [{ type: 'text', text: 'A' }, { type: 'tool_use' }, { type: 'text', text: 'B' }] })).toBe('AB');
    expect(textFromResponse('openai', { choices: [{ message: { content: 'C' } }] })).toBe('C');
    expect(textFromResponse('openai', null)).toBe('');
  });
});
