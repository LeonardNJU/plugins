// The chat: a conversation with the model about the message the user writes
// or reads, with tools it may call (tools.js) and proposals it makes.
//
// A proposal is text meant for the email, marked by the model with
// <text></text> tags (prompts.js tells it so). The panel shows it as a
// marked change with Replace and Insert buttons; everything outside the
// tags is the model talking to the user. Both are parsed while the answer
// is still coming in, so the preview grows word by word.

import { streamTurn } from './client.js';
import { AiError } from './errors.js';
import { clip } from './prompts.js';

/** How many turns of the conversation go back to the model. */
export const HISTORY_TURNS = 12;
/** Longest message of the history sent back, in characters. */
export const HISTORY_CHARS = 6000;
/** How often the model may call tools before it has to answer. */
export const MAX_TOOL_ROUNDS = 4;

const OPEN_RE = /<text>\s*/i;
const CLOSE_RE = /\s*<\/text>/i;

function stripFence(text) {
  const fenced = /^\s*```[a-z]*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return fenced ? fenced[1] : text;
}

/**
 * Split an answer into what the model says and what it proposes:
 * [{ kind: 'say', text } | { kind: 'proposal', text, open }]. `open` is a
 * proposal still coming in (no closing tag yet). Empty pieces are dropped.
 */
export function parseAnswer(answer) {
  const out = [];
  let rest = String(answer ?? '');
  const say = (text) => { if (text.trim()) out.push({ kind: 'say', text: text.trim() }); };
  for (;;) {
    const open = OPEN_RE.exec(rest);
    if (!open) {
      say(rest);
      break;
    }
    say(rest.slice(0, open.index));
    const after = rest.slice(open.index + open[0].length);
    const close = CLOSE_RE.exec(after);
    if (!close) {
      // Still streaming, or the model forgot the closing tag: all of it is the proposal.
      const text = stripFence(after.replace(/<\/?te?x?t?$/i, '')).replace(/^\n+/, '');
      out.push({ kind: 'proposal', text, open: true });
      break;
    }
    out.push({ kind: 'proposal', text: stripFence(after.slice(0, close.index)).trim(), open: false });
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
 * clipped, assistant answers as they were (proposal tags included), tool
 * steps left out.
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
 * onStep({ id, name, args, status, result }): a tool call starting ('running')
 * and finishing ('done' | 'failed').
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
      const step = { id: call.id, name: call.name, args: call.args, status: 'running', result: '' };
      steps.push(step);
      onStep({ ...step });
      let result;
      try {
        result = String(await runTool(call.name, call.args ?? {}));
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
