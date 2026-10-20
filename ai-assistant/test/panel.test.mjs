// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { anthropicSse, streamResponse } from './helpers.mjs';
import { AssistantPanel, sourceFor, taskForAction } from '../src/ui/Panel.jsx';
import { chatKey, pendingKey, COMPOSER_CONTEXT_KEY } from '../src/lib/background.js';
import manifest from '../manifest.json' with { type: 'json' };

// The chat panel next to the composer and next to an open message.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const CONFIG = { anthropicBaseUrl: 'http://localhost:18099/anthropic/v1' };
const CONSENT = 'consent:anthropic:http://localhost:18099';
const EMAIL = { id: 'M1', subject: 'Thursday', receivedAt: '2026-10-12T09:00:00Z', from: [{ name: 'Carol', email: 'carol@example.org' }], text: 'Can we meet on Thursday at 3?' };

/** A model that answers each request in turn; the last answer repeats. */
function makeApi({ answers = ['Answer.'], body = 'Hello Bob, can we meet tuesday? Thanks', consent = true, handlers = {} } = {}) {
  let i = 0;
  const api = fakeApi({
    translations: manifest.locales,
    handlers: {
      'admin.getAllConfig': async () => CONFIG,
      'composer.getBody': async () => ({ html: `<p>${body}</p>`, text: body }),
      'composer.replaceSelection': async () => true,
      'composer.replaceBody': async () => true,
      'compose.reply': async () => true,
      'proxy.fetch': async () => streamResponse(anthropicSse(answers[Math.min(i++, answers.length - 1)].match(/.{1,8}/gs))),
      ...handlers,
    },
  });
  if (consent) void api.storage.set(CONSENT, true);
  return api;
}

const sentPrompt = (api, n = -1) => JSON.parse(api.calls('proxy.fetch').at(n).args[2].body);
const button = (name) => screen.getByRole('button', { name });
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };
const type = async (text) => {
  await act(async () => { fireEvent.change(screen.getByRole('textbox', { name: 'Message to the assistant' }), { target: { value: text } }); });
};
const pressEnter = async () => {
  await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message to the assistant' }), { key: 'Enter' }); });
};
async function mount(api, props) {
  let view;
  await act(async () => { view = render(React.createElement(AssistantPanel, { api, ...props })); });
  await screen.findByRole('textbox', { name: 'Message to the assistant' });
  return view;
}
const settled = () => waitFor(() => expect(document.querySelector('[data-turn="assistant"][data-status="running"]')).toBeNull());

describe('what the panel works on', () => {
  it('is the selection, else the message, else nothing', () => {
    expect(sourceFor('composer', { selection: { text: 'part', empty: false }, body: 'whole' })).toEqual({ scope: 'selection', text: 'part' });
    expect(sourceFor('composer', { selection: { text: '', empty: true }, body: 'whole' })).toEqual({ scope: 'body', text: 'whole' });
    expect(sourceFor('composer', { selection: null, body: '  ' })).toEqual({ scope: 'empty', text: '' });
    expect(sourceFor('reader', { selection: { text: 'clause' }, email: EMAIL })).toEqual({ scope: 'passage', text: 'clause' });
    expect(sourceFor('reader', { selection: null, email: EMAIL })).toEqual({ scope: 'message', text: EMAIL.text });
  });

  it('maps quick actions to the tasks and how their answer is shown', () => {
    expect(taskForAction('composer', 'shorter', { scope: 'selection', text: 'x' })).toMatchObject({ task: 'rewrite', input: { style: 'shorter' }, show: 'proposal' });
    expect(taskForAction('composer', 'grammar', { scope: 'body', text: 'x' })).toMatchObject({ task: 'grammar', show: 'grammar' });
    expect(taskForAction('reader', 'summary', { scope: 'message', text: 'x' }, { email: EMAIL })).toMatchObject({ task: 'summary', show: 'text' });
    expect(taskForAction('reader', 'explain', { scope: 'passage', text: 'clause' }, { email: EMAIL })).toMatchObject({ task: 'explain', input: { text: 'clause' }, show: 'text' });
    expect(taskForAction('reader', 'replies', { scope: 'message', text: 'x' }, { email: EMAIL })).toMatchObject({ show: 'replies' });
  });
});

describe('the composer panel', () => {
  it('rewrites the selected text on a quick action, shows the change marked, and replaces the selection', async () => {
    const api = makeApi({ answers: ['could we meet on Tuesday?'] });
    await mount(api, { composerId: 'composer-7', selection: { text: 'can we meet tuesday?', empty: false }, focusRequest: 0 });
    expect(screen.getByText('Selected text')).toBeTruthy();
    expect(screen.getByText('can we meet tuesday?')).toBeTruthy();

    await click(button('Shorten'));
    await settled();
    // Only the selection went to the model, with the quick action's own prompt.
    expect(sentPrompt(api).messages[0].content).toBe('<draft>\ncan we meet tuesday?\n</draft>');
    expect(sentPrompt(api).tools).toBeUndefined();
    expect(screen.getByText('Shorten · selected text')).toBeTruthy();
    expect(document.querySelector('del').textContent).toContain('can');
    expect(document.querySelector('ins').textContent).toContain('could');

    await click(button('Replace'));
    await waitFor(() => expect(screen.getByText('Replaced')).toBeTruthy());
    expect(api.calls('composer.replaceSelection').map((c) => c.args)).toEqual([['composer-7', { text: 'could we meet on Tuesday?' }]]);
    expect(screen.getByText('Ctrl+Z takes it back')).toBeTruthy();
    // The transcript is kept for the composer.
    await waitFor(async () => expect((await api.storage.get(chatKey('composer', 'composer-7')))?.turns).toHaveLength(2));
  });

  it('answers a typed request as a chat, with the message in the system prompt and the tools offered, and inserts a tagged proposal', async () => {
    const api = makeApi({ answers: ['Here it is:\n<text>\nHello Bob, can we meet on Tuesday? I am away on Friday.\n</text>'] });
    await api.storage.set(COMPOSER_CONTEXT_KEY, { mode: 'reply', inReplyToId: 'M9', originalSubject: 'Lunch', at: Date.now() });
    await mount(api, { composerId: 'c1', selection: { text: '', empty: true }, focusRequest: 0 });
    expect(screen.getByText('Your message')).toBeTruthy();

    await type('add that I am away on Friday');
    await pressEnter();
    await settled();
    const prompt = sentPrompt(api);
    expect(prompt.system).toContain('<draft>\nHello Bob, can we meet tuesday? Thanks\n</draft>');
    expect(prompt.system).toContain('writing a reply to "Lunch"');
    expect(prompt.system).toContain('<text></text>');
    expect(prompt.tools.map((t) => t.name)).toEqual(['read_original_message', 'check_calendar', 'find_contact']);
    expect(prompt.messages.at(-1)).toEqual({ role: 'user', content: 'add that I am away on Friday' });
    expect(screen.getByText('Here it is:')).toBeTruthy();
    expect([...document.querySelectorAll('ins')].map((x) => x.textContent).join(' ')).toContain('away on Friday');

    await click(button('Replace message'));
    await waitFor(() => expect(api.calls('composer.replaceBody')).toHaveLength(1));
    expect(api.calls('composer.replaceBody')[0].args).toEqual(['c1', { text: 'Hello Bob, can we meet on Tuesday? I am away on Friday.' }]);
  });

  it('writes an empty message from a description and sends the earlier turns along', async () => {
    const api = makeApi({ body: '', answers: ['<text>Dear Anna,\nthank you for the offer.</text>', '<text>Dear Anna,\nthanks a lot for the offer!</text>'] });
    await mount(api, { composerId: 'c1', selection: { text: '', empty: true }, focusRequest: 0 });
    expect(screen.getByText('Empty message')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Shorten' })).toBeNull();

    await click(screen.getByRole('button', { name: 'Thank Anna for the offer and propose a call on Tuesday at 10' }));
    await pressEnter();
    await settled();
    expect(sentPrompt(api).system).toContain('The message is still empty');
    expect(screen.getByText(/thank you for the offer/)).toBeTruthy();
    await click(button('Insert'));
    await waitFor(() => expect(api.calls('composer.replaceBody')[0].args).toEqual(['c1', { text: 'Dear Anna,\nthank you for the offer.' }]));

    await type('warmer');
    await pressEnter();
    await settled();
    const messages = sentPrompt(api).messages;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1].content).toContain('<text>');
  });

  it('runs a request handed over from the right-click menu on the text it carries', async () => {
    const api = makeApi({ answers: ['Could we meet on Tuesday?'] });
    await api.storage.set(pendingKey('composer', 'c1'), { action: 'improve', text: 'can we meet tuesday?', at: Date.now() });
    await mount(api, { composerId: 'c1', selection: { text: 'can we meet tuesday?', empty: false }, focusRequest: 1 });
    await settled();
    expect(screen.getByText('Improve · selected text')).toBeTruthy();
    expect(sentPrompt(api).messages[0].content).toBe('<draft>\ncan we meet tuesday?\n</draft>');
    expect(await api.storage.get(pendingKey('composer', 'c1'))).toBeNull();
  });

  it('goes through spelling fixes one by one', async () => {
    const api = makeApi({ body: 'Teh cat sat on teh mat', answers: ['The cat sat on the mat'] });
    await mount(api, { composerId: 'c1', selection: { text: '', empty: true }, focusRequest: 0 });
    await click(button('Fix spelling'));
    await settled();
    expect(screen.getByText('2 of 2 suggestions left')).toBeTruthy();
    await click(screen.getAllByRole('button', { name: /Accept/ })[0]);
    expect(screen.getByText('1 of 2 suggestions left')).toBeTruthy();
    await click(button('Replace'));
    await waitFor(() => expect(api.calls('composer.replaceBody')[0].args).toEqual(['c1', { text: 'The cat sat on teh mat' }]));
  });

  it('retries a failed quick action with the same request', async () => {
    let n = 0;
    const api = makeApi({ handlers: { 'proxy.fetch': async () => (n++ === 0
      ? { status: 429, ok: false, headers: { 'retry-after': '1' }, body: '' }
      : streamResponse(anthropicSse(['shorter.']))) } });
    await mount(api, { composerId: 'c1', selection: { text: 'can we meet tuesday?', empty: false }, focusRequest: 0 });
    await click(button('Shorten'));
    await settled();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(button('Try again').disabled).toBe(false), { timeout: 3000 });
    await click(button('Try again'));
    await settled();
    const sent = sentPrompt(api);
    expect(sent.system).toContain('noticeably shorter');
    expect(sent.messages[0].content).toBe('<draft>\ncan we meet tuesday?\n</draft>');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('[data-turn="user"]')).toHaveLength(1);
  });

  it('asks for the privacy notice before the first request and does nothing when declined', async () => {
    const api = makeApi({ consent: false });
    await mount(api, { composerId: 'c1', selection: { text: 'x', empty: false }, focusRequest: 0 });
    await click(button('Improve'));
    expect(await screen.findByText('Send text to the AI service?')).toBeTruthy();
    await click(button('Cancel'));
    expect(api.calls('proxy.fetch')).toHaveLength(0);
    expect(document.querySelectorAll('[data-turn]')).toHaveLength(0);
  });

  it('says so when no service is set up', async () => {
    const api = makeApi({ handlers: { 'admin.getAllConfig': async () => ({}) } });
    await act(async () => { render(React.createElement(AssistantPanel, { api, composerId: 'c1', selection: { text: '', empty: true } })); });
    expect(await screen.findByText('The assistant is not set up yet.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the reader panel', () => {
  it('summarises the open message and lets the user ask about it', async () => {
    const api = makeApi({ answers: ['- Carol asks for a meeting on Thursday at 3', 'Yes, at 3 pm.'] });
    await mount(api, { email: EMAIL, selection: { text: '' }, focusRequest: 0 });
    expect(screen.getByText('This message')).toBeTruthy();
    await click(button('Summarize'));
    await settled();
    expect(sentPrompt(api).messages[0].content).toContain('Subject: Thursday');
    expect(screen.getByText('- Carol asks for a meeting on Thursday at 3')).toBeTruthy();

    await type('is there a time?');
    await pressEnter();
    await settled();
    expect(sentPrompt(api).system).toContain('<email>');
    expect(sentPrompt(api).system).toContain('Can we meet on Thursday at 3?');
    expect(screen.getByText('Yes, at 3 pm.')).toBeTruthy();
  });

  it('works on a highlighted passage: explains it, and opens a drafted reply', async () => {
    const api = makeApi({ answers: ['It means Thursday afternoon.', '<text>Hi Carol, Thursday at 3 works for me.</text>'] });
    await mount(api, { email: EMAIL, selection: { text: 'Thursday at 3' }, focusRequest: 0 });
    expect(screen.getByText('Highlighted passage')).toBeTruthy();
    await click(button('Explain'));
    await settled();
    expect(sentPrompt(api).messages[0].content).toContain('<passage>\nThursday at 3\n</passage>');
    expect(screen.getByText('It means Thursday afternoon.')).toBeTruthy();

    await click(button('Draft a reply'));
    await settled();
    expect(sentPrompt(api).messages.at(-1).content).toContain('answers the passage I highlighted');
    await click(button('Open as reply'));
    await waitFor(() => expect(api.calls('compose.reply').map((c) => c.args)).toEqual([['M1', { text: 'Hi Carol, Thursday at 3 works for me.' }]]));
    expect(screen.getByText('Reply opened')).toBeTruthy();
  });

  it('shows the model\'s lookups as steps', async () => {
    const ev = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const toolTurn = ev('message_start', { type: 'message_start' })
      + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'check_calendar' } })
      + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"from":"2026-10-15","to":"2026-10-15"}' } })
      + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
      + ev('message_stop', { type: 'message_stop' });
    let n = 0;
    const api = makeApi({ handlers: {
      'proxy.fetch': async () => streamResponse(n++ === 0 ? toolTurn : anthropicSse(['You are free then.'])),
      'calendar.getEvents': async () => [],
    } });
    await mount(api, { email: EMAIL, selection: { text: '' }, focusRequest: 0 });
    await type('am I free?');
    await pressEnter();
    await settled();
    const step = document.querySelector('[data-step="check_calendar"]');
    expect(step.dataset.stepStatus).toBe('done');
    expect(step.textContent).toContain('Checked your calendar (2026-10-15 to 2026-10-15)');
    expect(screen.getByText('You are free then.')).toBeTruthy();
    expect(api.calls('calendar.getEvents')[0].args).toEqual([{ from: '2026-10-15', to: '2026-10-16' }]);
  });

  it('offers no lookups when the user turned them off', async () => {
    const api = makeApi({ answers: ['Fine.'] });
    await api.storage.set('prefs', { lookups: false });
    await mount(api, { email: EMAIL, selection: { text: '' }, focusRequest: 0 });
    await type('ok?');
    await pressEnter();
    await settled();
    expect(sentPrompt(api).tools).toBeUndefined();
  });
});
