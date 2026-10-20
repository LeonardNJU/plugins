// The chat: a conversation with the model about the message the user writes
// or reads, with tools it may call (tools.js), proposals it makes and
// widgets it adds.
//
// A proposal is text meant for the email, marked by the model with
// <text></text> tags; a widget is a card the panel draws, marked with
// <widget></widget> around JSON (prompts.js tells it both). The panel shows
// a proposal as a marked change with Replace and Insert buttons, a widget
// as its card, and everything outside the tags as the model talking to the
// user, in Markdown. All of it is parsed while the answer is still coming
// in, so the preview grows word by word.

import { streamTurn } from './client.js';
import { AiError } from './errors.js';
import { clip } from './prompts.js';
import { parseWidgetJson } from './widgets.js';

/** How many turns of the conversation go back to the model. */
export const HISTORY_TURNS = 12;
/** Longest message of the history sent back, in characters. */
export const HISTORY_CHARS = 6000;
/** How often the model may call tools before it has to answer. */
export const MAX_TOOL_ROUNDS = 4;

const TAGS = { text: /<text>\s*/i, widget: /<widget>\s*/i };
const CLOSE = { text: /\s*<\/text>/i, widget: /\s*<\/widget>/i };

function stripFence(text) {
  const fenced = /^\s*```[a-z]*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return fenced ? fenced[1] : text;
}

/** The earliest opening tag in `rest`: { kind, index, length } or null. */
function nextTag(rest) {
  let best = null;
  for (const kind of Object.keys(TAGS)) {
    const m = TAGS[kind].exec(rest);
    if (m && (!best || m.index < best.index)) best = { kind, index: m.index, length: m[0].length };
  }
  return best;
}

/**
 * Split an answer into what the model says and what it adds:
 * [{ kind: 'say', text } | { kind: 'proposal', text, open } | { kind: 'widget', widget, open }].
 * `open` marks a block still coming in (no closing tag yet); an unfinished
 * widget has no `widget` yet. Empty pieces and unreadable widgets are dropped.
 */
export function parseAnswer(answer) {
  const out = [];
  let rest = String(answer ?? '');
  const say = (text) => { if (text.trim()) out.push({ kind: 'say', text: text.trim() }); };
  for (;;) {
    const open = nextTag(rest);
    if (!open) {
      say(rest);
      break;
    }
    say(rest.slice(0, open.index));
    const after = rest.slice(open.index + open.length);
    const close = CLOSE[open.kind].exec(after);
    if (!close) {
      // Still streaming, or the model forgot the closing tag.
      const body = after.replace(/<\/?(?:te?x?t?|wi?d?g?e?t?)$/i, '');
      if (open.kind === 'text') out.push({ kind: 'proposal', text: stripFence(body).replace(/^\n+/, ''), open: true });
      else out.push({ kind: 'widget', widget: null, open: true });
      break;
    }
    const body = after.slice(0, close.index);
    if (open.kind === 'text') out.push({ kind: 'proposal', text: stripFence(body).trim(), open: false });
    else {
      const widget = parseWidgetJson(stripFence(body));
      if (widget) out.push({ kind: 'widget', widget, open: false });
    }
    rest = after.slice(close.index + close[0].length);
  }
  return out;
}

/** The first proposal of an answer, finished or not; null without one. */
export function proposalOf(answer) {
  return parseAnswer(answer).find((p) => p.kind === 'proposal') ?? null;
}

/**
 * The transcript's turns as messages for the model: the last turns, each
 * clipped, assistant answers as they were (tags included), tool steps left
 * out.
 */
export function historyMessages(turns, { limit = HISTORY_TURNS, chars = HISTORY_CHARS } = {}) {
  return turns
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
    .slice(-limit)
    .map((t) => ({ role: t.role, content: clip(t.content, chars) }));
}

/**
 * One exchange: send the conversation, let the model call tools (each
 * result goes back to it), and stream its final answer.
 *
 * onText(fullAnswer): the answer so far, text of every round joined.
 * onStep({ id, name, args, status, result, widget }): a tool call starting
 * ('running') and finishing ('done' | 'failed'). `runTool` resolves to the
 * text for the model, or { text, widget } with a card for the panel.
 * Resolves to { text, steps }. Rejects with AiError like streamTurn.
 */
export async function runChat(api, endpoint, { system, messages, tools = [], runTool, maxTokens = 2500 }, {
  onText = () => {},
  onStep = () => {},
  signal,
  timeouts = {},
} = {}) {
  const history = [...messages];
  const steps = [];
  let said = '';
  const prefix = () => (said ? `${said}\n\n` : '');
  for (let round = 0; ; round++) {
    const allowTools = tools.length > 0 && typeof runTool === 'function' && round < MAX_TOOL_ROUNDS;
    const turn = await streamTurn(api, endpoint, {
      system,
      messages: history,
      maxTokens,
      ...(allowTools ? { tools } : {}),
    }, {
      signal,
      ...timeouts,
      onText: (full) => onText(prefix() + full),
    });
    if (turn.text.trim()) said = prefix() + turn.text;
    if (!turn.toolCalls.length) {
      if (!said.trim()) throw new AiError('empty');
      onText(said);
      return { text: said, steps };
    }
    history.push({ role: 'assistant', content: turn.text, toolCalls: turn.toolCalls });
    for (const call of turn.toolCalls) {
      if (signal?.aborted) throw new AiError('cancelled', { partial: said });
      const step = { id: call.id, name: call.name, args: call.args, status: 'running', result: '', widget: null };
      steps.push(step);
      onStep({ ...step });
      let result;
      try {
        const out = await runTool(call.name, call.args ?? {});
        if (out && typeof out === 'object') {
          result = String(out.text ?? '');
          step.widget = out.widget ?? null;
        } else {
          result = String(out);
        }
        step.status = 'done';
      } catch (err) {
        result = `The tool failed: ${err?.message ?? 'unknown error'}`;
        step.status = 'failed';
      }
      step.result = result;
      onStep({ ...step });
      history.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result });
    }
  }
}
