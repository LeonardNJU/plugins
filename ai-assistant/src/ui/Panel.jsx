// The assistant panel: a chat next to the message the user writes
// (composer-sidebar-right) or reads (email-detail-sidebar). It works on what
// the user highlights, else on the whole message; quick actions and typed
// requests go into one transcript, where the model's proposals show as a
// marked change with Replace and Insert buttons, and its lookups as steps.
// The frame fills the panel (slots[...].fill), so the input stays at the
// bottom and the transcript scrolls.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Chip, DiffView, Icon, LinkButton, List, ListRow, Row, RowAction, Select, Spinner, Stack, Text, Textarea,
} from '@plugin-host/ui';
import { ConsentNotice, ErrorMessage, copyWithToast, useApi } from './common.jsx';
import { Markdown, stripMarkdown } from './Markdown.jsx';
import { Widget } from './Widgets.jsx';
import { ActionItems, Replies, emailForPrompt } from './Reader.jsx';
import { keepEdges } from './AssistantDialog.jsx';
import { ensureConsent, loadPrefs, loadSetup, savePrefs } from '../lib/assistant.js';
import { composerChatSystem, readerChatSystem, buildPrompt, contextSuffix, REWRITE_STYLES } from '../lib/prompts.js';
import { loadPerson, localNow } from '../lib/person.js';
import { historyMessages, parseAnswer, runChat } from '../lib/chat.js';
import { runTool, toolsFor } from '../lib/tools.js';
import { streamCompletion } from '../lib/client.js';
import { AiError } from '../lib/errors.js';
import { defaultTarget, languageOptions } from '../lib/languages.js';
import { acceptAll, applySuggestions, diffSuggestions, pendingSuggestions, reviewParts, reviewStep } from '../lib/grammar.js';
import { diffWords, plainParts } from '../lib/diff.js';
import { COMPOSER_CONTEXT_KEY, COMPOSER_PANEL, DRAFT_KEY, chatKey, pendingKey } from '../lib/background.js';

/** Quick actions on text in the composer. */
export const COMPOSER_ACTIONS = [...REWRITE_STYLES, 'grammar', 'translate'];
/** Quick actions on an open message, and on a highlighted passage of it. */
export const READER_ACTIONS = ['summary', 'actions', 'replies', 'translate'];
export const PASSAGE_ACTIONS = ['explain', 'translate', 'reply'];
/** Turns kept in the transcript (older ones are dropped when saving). */
const MAX_TURNS = 40;
/** A pending request from a right-click entry is dropped after this long. */
const PENDING_TTL_MS = 60_000;

const uid = () => Math.random().toString(36).slice(2, 10);
const excerpt = (text, max = 90) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const today = () => new Date().toISOString().slice(0, 10);

/** The text a request works on: the selection, else the message. */
export function sourceFor(mode, { selection, body, email }) {
  const selected = selection?.text?.trim() ? selection.text : '';
  if (mode === 'composer') {
    if (selected) return { scope: 'selection', text: selected };
    return body?.trim() ? { scope: 'body', text: body } : { scope: 'empty', text: '' };
  }
  if (selected) return { scope: 'passage', text: selected };
  return { scope: 'message', text: email?.text ?? '' };
}

/** What a quick action sends, as a task of prompts.js, and how its result is shown. */
export function taskForAction(mode, action, source, { target, email, instruction } = {}) {
  if (mode === 'composer') {
    if (REWRITE_STYLES.includes(action)) return { task: 'rewrite', input: { text: source.text, style: action }, show: 'proposal' };
    if (action === 'translate') return { task: 'translate', input: { text: source.text, target }, show: 'proposal' };
    if (action === 'grammar') return { task: 'grammar', input: { text: source.text }, show: 'grammar' };
    if (action === 'write') return { task: 'write', input: { prompt: instruction, subject: email?.subject ?? '' }, show: 'proposal' };
    return { task: 'edit', input: { text: source.text, instruction }, show: 'proposal' };
  }
  const mail = email ? emailForPrompt(email) : null;
  if (action === 'summary') return { task: 'summary', input: { email: mail }, show: 'text' };
  if (action === 'actions') return { task: 'actions', input: { email: mail, today: today() }, show: 'actions' };
  if (action === 'replies') return { task: 'replies', input: { email: mail }, show: 'replies' };
  if (action === 'explain') return { task: 'explain', input: { email: mail, text: source.text }, show: 'text' };
  return { task: 'translate', input: { text: source.text, target }, show: 'text' };
}

/** Load a saved transcript; [] when there is none. */
async function loadTurns(api, key) {
  try {
    const saved = await api.storage.get(key);
    const turns = Array.isArray(saved?.turns) ? saved.turns : [];
    // A turn that was still running when the panel went away is shown as stopped.
    return turns.map((t) => (t.status === 'running' ? { ...t, status: t.content ? 'stopped' : 'error', error: t.content ? undefined : { code: 'cancelled' } } : t));
  } catch {
    return [];
  }
}

export function AssistantPanel(props) {
  const api = useApi(props);
  const t = api.i18n.t;
  const locale = api.i18n.getLocale?.() ?? 'en';
  const mode = props.composerId ? 'composer' : 'reader';
  const id = mode === 'composer' ? props.composerId : props.email?.id;
  const email = props.email ?? null;
  const selection = props.selection ?? null;
  const key = id ? chatKey(mode, id) : null;

  const [setup, setSetup] = useState(null);
  const [prefs, setPrefs] = useState({});
  const [person, setPerson] = useState(null);
  const [turns, setTurns] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [body, setBody] = useState('');
  const [context, setContext] = useState(null);
  const [subject, setSubject] = useState('');
  const [input, setInput] = useState('');
  const [consent, setConsent] = useState(null);
  const [target, setTarget] = useState(defaultTarget(locale));
  const [translating, setTranslating] = useState(false);
  const languages = useMemo(() => languageOptions(locale), [locale]);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const controller = useRef(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const source = useMemo(() => sourceFor(mode, { selection, body, email }), [mode, selection, body, email]);
  const running = turns.some((turn) => turn.status === 'running');
  const lookups = prefs.lookups !== false;

  // ─── Loading: the service, the user's choices, the saved transcript ───
  const refreshBody = useCallback(async () => {
    if (mode !== 'composer' || !props.composerId) return;
    try {
      const read = await api.composer.getBody(props.composerId);
      setBody(read?.text ?? '');
    } catch { /* the composer is gone */ }
  }, [api, mode, props.composerId]);

  useEffect(() => {
    let live = true;
    // Another message or composer: nothing of the old chat is shown or saved
    // under the new key while its own transcript loads.
    setLoaded(false);
    setTurns([]);
    void (async () => {
      const [next, saved, ctx, draft, who] = await Promise.all([
        loadSetup(api).catch(() => ({ endpoint: null, prefs: {} })),
        key ? loadTurns(api, key) : [],
        api.storage.get(COMPOSER_CONTEXT_KEY).catch(() => null),
        api.storage.get(DRAFT_KEY).catch(() => null),
        loadPerson(api, locale).catch(() => null),
      ]);
      if (!live) return;
      setSetup(next);
      setPerson(who);
      setPrefs(next.prefs ?? {});
      setTarget(defaultTarget(locale, next.prefs?.translateTo));
      setTurns(saved);
      setContext(ctx && typeof ctx === 'object' ? ctx : null);
      if (typeof draft?.subject === 'string') setSubject(draft.subject);
      setLoaded(true);
    })();
    void refreshBody();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The message the user wrote changes while they type; look again when
  // they pick text or come back to the panel.
  useEffect(() => { void refreshBody(); }, [refreshBody, selection?.text, props.focusRequest]);

  // Save the transcript as it changes (not while an answer streams).
  useEffect(() => {
    if (!loaded || !key || running) return;
    const timer = setTimeout(() => {
      void api.storage.set(key, { turns: turns.slice(-MAX_TURNS), at: Date.now() }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [api, key, turns, loaded, running]);

  // Keep the newest turn in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // ─── The transcript ───
  const patchTurn = useCallback((turnId, patch) => {
    setTurns((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, ...(typeof patch === 'function' ? patch(turn) : patch) } : turn)));
  }, []);

  const stop = useCallback(() => {
    controller.current?.abort();
    consent?.answer(false);
  }, [consent]);

  const askConsent = useCallback((endpoint) => new Promise((resolve) => {
    setConsent({ endpoint, answer: (ok) => { setConsent(null); resolve(ok); } });
  }), []);

  /**
   * One exchange: a quick action (a task of prompts.js) or a typed request
   * (the chat). `label` is what the user turn shows; `sent` what the chat
   * sends when it differs.
   */
  /** Who the user is and their standing instructions, for this request. */
  const extraContext = useCallback(() => contextSuffix({
    person: person ? { ...person, now: localNow(person.timeZone) } : null,
    instructions: { admin: setup?.config?.instructions, user: prefs.instructions },
  }), [person, setup, prefs]);

  const send = useCallback(async ({ label, sent, task, input: taskInput, show, scope, src }) => {
    const endpoint = setup?.endpoint;
    if (!endpoint) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const userTurn = { id: uid(), role: 'user', content: sent ?? label, label };
    const turn = { id: uid(), role: 'assistant', content: '', status: 'running', task: task ?? 'chat', show: show ?? 'chat', scope, source: src ?? '', steps: [], ...(task ? { input: taskInput ?? {} } : {}) };
    const previous = turnsRef.current;
    setTurns([...previous, userTurn, turn]);
    try {
      if (!(await ensureConsent(api, endpoint, askConsent))) throw new AiError('declined');
      if (abort.signal.aborted) throw new AiError('cancelled');
      const onText = (full) => patchTurn(turn.id, { content: full });
      let text;
      const extra = extraContext();
      if (task) {
        const prompt = buildPrompt(task, { language: locale, extra, ...taskInput });
        text = await streamCompletion(api, endpoint, prompt, { onText, signal: abort.signal });
      } else {
        const ctx = { inReplyToId: mode === 'composer' ? context?.inReplyToId : undefined, lookups };
        const tools = toolsFor(ctx);
        const system = mode === 'composer'
          ? composerChatSystem({ language: locale, today: today(), subject, mode: context?.mode, originalSubject: context?.originalSubject, scope, text: src, hasTools: tools.length > 0, extra })
          : readerChatSystem({ language: locale, today: today(), email: email ? emailForPrompt(email) : null, selection: scope === 'passage' ? src : '', hasTools: tools.length > 0, extra });
        const messages = [...historyMessages(previous), { role: 'user', content: userTurn.content }];
        const out = await runChat(api, endpoint, {
          system, messages, tools, runTool: (name, args) => runTool(api, name, args, ctx),
        }, {
          onText,
          onStep: (step) => patchTurn(turn.id, (cur) => ({ steps: cur.steps.some((s) => s.id === step.id) ? cur.steps.map((s) => (s.id === step.id ? step : s)) : [...cur.steps, step] })),
          signal: abort.signal,
        });
        text = out.text;
      }
      if (task === 'grammar') {
        const corrected = keepEdges(src, text) || src;
        patchTurn(turn.id, { content: text, status: 'done', review: { segments: diffSuggestions(src, corrected), states: {} } });
      } else {
        patchTurn(turn.id, { content: text, status: 'done' });
      }
    } catch (err) {
      const error = err instanceof AiError ? err : new AiError('unreachable', { detail: err?.message });
      if (!(err instanceof AiError) || error.detail) api.log?.warn?.(`${task ?? 'chat'} failed`, err?.message ?? err);
      if (error.code === 'declined') {
        setTurns((prev) => prev.filter((x) => x.id !== turn.id && x.id !== userTurn.id));
      } else if (error.code === 'cancelled') {
        patchTurn(turn.id, (cur) => ({ status: 'stopped', content: error.partial || cur.content }));
      } else {
        patchTurn(turn.id, (cur) => ({ status: 'error', content: error.partial || cur.content, error: { code: error.code, detail: error.detail, retryAfter: error.retryAfter } }));
      }
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }, [api, setup, askConsent, patchTurn, locale, mode, context, lookups, subject, email, extraContext]);

  /** A quick action on the current source (or on `text` from a right-click). */
  const quick = useCallback((action, { text, targetTag } = {}) => {
    const src = text ? { scope: mode === 'composer' ? 'selection' : 'passage', text } : source;
    if (action === 'reply') {
      void send({
        label: `${t('panel.quick.reply')} · ${t(`panel.scope.${src.scope}`)}`,
        sent: src.scope === 'passage' ? `Draft a reply to this email that answers the passage I highlighted:\n<passage>\n${src.text}\n</passage>` : 'Draft a reply to this email.',
        scope: src.scope, src: src.text,
      });
      return;
    }
    const { task, input: taskInput, show } = taskForAction(mode, action, src, { target: targetTag ?? target, email });
    const scopeLabel = t(`panel.scope.${src.scope}`);
    const name = action === 'translate'
      ? t('panel.translate_to', { language: languages.find((l) => l.tag === (targetTag ?? target))?.label ?? (targetTag ?? target) })
      : t(mode === 'composer' ? `assistant.action.${action}` : `reader.${action}`, {});
    if (action !== 'translate' && mode === 'composer') void savePrefs(api, { lastAction: action });
    void send({ label: `${name} · ${scopeLabel}`, task, input: taskInput, show, scope: src.scope, src: src.text });
  }, [api, mode, source, target, email, languages, send, t]);

  /** The typed request. */
  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || running || !setup?.endpoint) return;
    setInput('');
    void send({ label: text, scope: source.scope, src: source.text });
  }, [input, running, setup, send, source]);

  // ─── Requests from the toolbar button and the right-click menu ───
  useEffect(() => {
    if (!loaded || !id) return;
    let live = true;
    void (async () => {
      const pkey = pendingKey(mode, id);
      let pending = null;
      try { pending = await api.storage.get(pkey); } catch { pending = null; }
      if (!live || !pending || typeof pending !== 'object') return;
      await api.storage.remove(pkey).catch(() => {});
      if (!pending.at || Date.now() - pending.at > PENDING_TTL_MS) return;
      if (pending.action === 'ask' || !pending.action) {
        inputRef.current?.focus();
        return;
      }
      quick(pending.action, pending.text ? { text: pending.text } : {});
    })();
    inputRef.current?.focus();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, id, props.focusRequest]);

  // ─── Applying a proposal ───
  const apply = useCallback(async (turn, how, text) => {
    patchTurn(turn.id, { applying: how });
    try {
      let ok;
      if (mode === 'reader') {
        ok = await api.compose.reply(email.id, { text: text.trim() });
      } else if (how === 'below') {
        ok = await api.composer.replaceSelection(props.composerId, { text: text.trim() }, { below: true });
      } else if (how === 'cursor') {
        ok = await api.composer.replaceSelection(props.composerId, { text: text.trim() });
      } else if (turn.scope === 'selection') {
        ok = await api.composer.replaceSelection(props.composerId, { text });
      } else {
        ok = await api.composer.replaceBody(props.composerId, { text: text.trim() });
      }
      if (ok === false) throw new Error('refused');
      patchTurn(turn.id, { applying: null, applied: how });
      void refreshBody();
    } catch (err) {
      api.log?.warn?.('could not change the message', err?.message ?? err);
      patchTurn(turn.id, { applying: null, applyFailed: true });
    }
  }, [api, mode, email, props.composerId, patchTurn, refreshBody]);

  /** A widget's request: into the chat, on the current text. */
  const sendText = useCallback((text) => {
    const value = String(text ?? '').trim();
    if (!value || running || !setup?.endpoint) return;
    void send({ label: value, scope: source.scope, src: source.text });
  }, [running, setup, send, source]);

  /** A widget's text into the message, where the cursor is. */
  const insertText = useCallback(async (text) => {
    if (mode !== 'composer') return;
    try {
      const ok = await api.composer.replaceSelection(props.composerId, { text: String(text ?? '') });
      if (ok === false) throw new Error('refused');
      void refreshBody();
    } catch (err) {
      api.log?.warn?.('could not insert', err?.message ?? err);
      api.toast.error(t('assistant.apply_failed'));
    }
  }, [api, mode, props.composerId, refreshBody, t]);

  const clear = useCallback(() => {
    stop();
    setTurns([]);
    if (key) void api.storage.remove(key).catch(() => {});
  }, [api, key, stop]);

  const retry = useCallback((turn) => {
    const i = turnsRef.current.findIndex((x) => x.id === turn.id);
    const userTurn = i > 0 ? turnsRef.current[i - 1] : null;
    if (!userTurn || userTurn.role !== 'user') return;
    // send() starts from turnsRef: drop the failed exchange there too, before React re-renders.
    const rest = turnsRef.current.filter((x) => x.id !== turn.id && x.id !== userTurn.id);
    turnsRef.current = rest;
    setTurns(rest);
    if (turn.task && turn.task !== 'chat' && turn.input) {
      // The quick action again, with what it was asked the first time.
      void send({ label: userTurn.label ?? userTurn.content, task: turn.task, input: turn.input, show: turn.show, scope: turn.scope, src: turn.source });
    } else {
      void send({ label: userTurn.label ?? userTurn.content, sent: userTurn.content, scope: turn.scope, src: turn.source });
    }
  }, [send]);

  // ─── Rendering ───
  const fill = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 };
  if (!loaded) {
    return <div style={{ ...fill, alignItems: 'center', justifyContent: 'center' }}><Spinner label={t('common.loading')} /></div>;
  }
  if (!setup?.endpoint) {
    return (
      <div style={{ padding: 16 }}>
        <Alert tone="info" icon="sparkles">
          <Stack gap={1}>
            <Text weight="medium">{t('panel.not_set_up')}</Text>
            <Text tone="muted" size="xs">{t('panel.not_set_up_hint')}</Text>
          </Stack>
        </Alert>
      </div>
    );
  }

  const contextLabel = {
    selection: t('panel.context.selection'),
    body: t('panel.context.body'),
    empty: t('panel.context.empty'),
    message: t('panel.context.message'),
    passage: t('panel.context.passage'),
  }[source.scope];
  const contextIcon = source.scope === 'selection' || source.scope === 'passage' ? 'highlight' : source.scope === 'empty' ? 'pencil' : 'mail';
  // A whole message goes by its subject; highlighted text and the draft by their first words.
  const mailSubject = (email?.subject ?? '').trim();
  const contextDetail = source.scope === 'message' && mailSubject ? excerpt(mailSubject, 60) : source.text ? excerpt(source.text, 40) : '';
  const contextTitle = source.scope === 'message' && mailSubject ? mailSubject : source.text ? excerpt(source.text, 400) : contextLabel;
  const actions = mode === 'composer'
    ? (source.scope === 'empty' ? [] : COMPOSER_ACTIONS)
    : (source.scope === 'passage' ? PASSAGE_ACTIONS : READER_ACTIONS);
  const actionLabel = (action) => {
    if (action === 'translate') return t('assistant.action.translate');
    if (mode === 'composer') return t(`assistant.action.${action}`);
    return t(action === 'explain' || action === 'reply' ? `panel.quick.${action}` : `reader.${action}`);
  };
  const placeholder = mode === 'reader'
    ? t('panel.placeholder.read')
    : source.scope === 'empty' ? t('panel.placeholder.write') : t('panel.placeholder.compose');

  return (
    <div style={fill} data-assistant-panel={mode}>
      <div style={{ padding: '10px 16px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <Row justify="between" wrap={false}>
          <Row gap={1} wrap={false}>
            <Icon name="sparkles" size="sm" className="text-primary" />
            <Text size="sm" weight="semibold">{t('composer.title')}</Text>
          </Row>
          {turns.length > 0 && (
            <Button variant="ghost" size="icon" icon="eraser" title={t('panel.new_chat')} aria-label={t('panel.new_chat')} onClick={clear} />
          )}
        </Row>
      </div>

      {/* The transcript. */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px' }} data-assistant-transcript>
        {turns.length === 0 && !consent && (
          <Stack gap={2}>
            <Text tone="muted" size="xs">{t(mode === 'reader' ? 'panel.empty.read' : source.scope === 'empty' ? 'panel.empty.write' : 'panel.empty.compose')}</Text>
            {mode === 'composer' && source.scope === 'empty' && (
              <Stack gap={1}>
                {[1, 2, 3].map((n) => (
                  <LinkButton key={n} icon="arrow-right" onClick={() => { setInput(t(`panel.example_${n}`)); inputRef.current?.focus(); }}>{t(`panel.example_${n}`)}</LinkButton>
                ))}
              </Stack>
            )}
          </Stack>
        )}
        <Stack gap={4}>
          {turns.map((turn) => (
            turn.role === 'user'
              ? <UserTurn key={turn.id} turn={turn} />
              : (
                <AssistantTurn
                  key={turn.id}
                  api={api}
                  mode={mode}
                  turn={turn}
                  email={email}
                  onApply={apply}
                  onRetry={retry}
                  onReview={(review) => patchTurn(turn.id, { review })}
                  onSend={sendText}
                  onInsert={insertText}
                />
              )
          ))}
          {consent && (
            <Stack gap={2}>
              <ConsentNotice api={api} consent={consent} />
              <Row justify="end">
                <Button variant="secondary" size="sm" onClick={() => consent.answer(false)}>{t('common.cancel')}</Button>
                <Button size="sm" onClick={() => consent.answer(true)}>{t('privacy.continue')}</Button>
              </Row>
            </Stack>
          )}
        </Stack>
      </div>

      {/* The input: what the assistant works on, the text field, the quick actions and Send. */}
      <div style={{ padding: '8px 12px 12px', flexShrink: 0 }}>
        <div data-assistant-input style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '8px 8px 6px', background: 'var(--color-background)' }}>
        <Stack gap={1}>
          <Row gap={1} wrap={false} className="min-w-0">
            <Chip icon={contextIcon} label={contextLabel} detail={contextDetail || undefined} title={contextTitle} />
          </Row>
          <Textarea
            ref={inputRef}
            rows={Math.min(6, Math.max(2, input.split('\n').length))}
            value={input}
            placeholder={placeholder}
            aria-label={t('panel.input_label')}
            title={t('panel.enter_hint')}
            style={{ border: 0, boxShadow: 'none', outline: 'none', background: 'transparent', padding: '4px 4px', resize: 'none' }}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape' && !input && mode === 'composer') {
                // Back to the message; Alt+A brings the panel back.
                e.preventDefault();
                void api.ui.closePanel?.(COMPOSER_PANEL, { composerId: props.composerId })?.catch?.(() => {});
              }
            }}
          />
          <Row justify="between" wrap={false}>
            <Row gap={1} wrap={false}>
              {actions.length > 0 && (translating ? (
                <Row gap={1} wrap={false}>
                  <Select
                    value={target}
                    aria-label={t('composer.translate_label')}
                    options={languages.map((l) => ({ value: l.tag, label: l.label }))}
                    onChange={(value) => {
                      setTarget(value);
                      setTranslating(false);
                      void savePrefs(api, { translateTo: value });
                      quick('translate', { targetTag: value });
                    }}
                  />
                  <Button variant="ghost" size="icon" icon="x" aria-label={t('common.cancel')} onClick={() => setTranslating(false)} />
                </Row>
              ) : (
                <ActionsMenu
                  api={api}
                  actions={actions}
                  actionLabel={actionLabel}
                  disabled={running}
                  onPick={(action) => (action === 'translate' ? setTranslating(true) : quick(action))}
                />
              ))}
            </Row>
            {running
              ? <Button variant="secondary" size="sm" icon="player-stop" onClick={stop}>{t('common.stop')}</Button>
              : <Button size="icon" icon="arrow-up" disabled={!input.trim()} title={t('panel.send')} aria-label={t('panel.send')} onClick={submit} />}
          </Row>
        </Stack>
        </div>
      </div>
    </div>
  );
}

const ACTION_ICONS = {
  improve: 'wand', shorter: 'arrows-minimize', formal: 'tie', casual: 'mood-smile', grammar: 'spell-check', translate: 'language',
  summary: 'align-left', actions: 'checklist', replies: 'message-reply', explain: 'bulb', reply: 'mail-forward',
};

/** The quick actions, in a menu that opens above its button. */
function ActionsMenu({ api, actions, actionLabel, disabled, onPick }) {
  const t = api.i18n.t;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }} data-assistant-actions>
      <Button variant="ghost" size="sm" icon="sparkles" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t('panel.actions')}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size="xs" className="text-muted-foreground" />
      </Button>
      {open && (
        <div role="menu" style={{ position: 'absolute', bottom: 'calc(100% + 4px)', insetInlineStart: 0, minWidth: 200, zIndex: 20, background: 'var(--color-popover, var(--color-background))', color: 'var(--color-foreground)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)', padding: 4 }}>
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              className="bk hover:bg-muted rounded-md"
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', background: 'none', border: 0, font: 'inherit', fontSize: '0.875rem', color: 'inherit', textAlign: 'start', cursor: 'pointer' }}
              onClick={() => { setOpen(false); onPick(action); }}
            >
              <Icon name={ACTION_ICONS[action] ?? 'sparkles'} size="sm" className="text-muted-foreground" />
              <span>{actionLabel(action)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserTurn({ turn }) {
  return (
    <Row justify="end">
      <div style={{ maxWidth: '85%', background: 'var(--color-muted)', color: 'var(--color-foreground)', borderRadius: 12, padding: '6px 10px' }} data-turn="user">
        <Text size="sm">{turn.label ?? turn.content}</Text>
      </div>
    </Row>
  );
}

/** The model's answer: what it says, what it proposes, what it looked up. */
function AssistantTurn({ api, mode, turn, email, onApply, onRetry, onReview, onSend, onInsert }) {
  const t = api.i18n.t;
  const running = turn.status === 'running';
  const parts = useMemo(() => partsOf(turn), [turn]);
  return (
    <div data-turn="assistant" data-status={turn.status}>
    <Stack gap={2}>
      {turn.steps?.length > 0 && <StepsGroup api={api} mode={mode} steps={turn.steps} running={running} onSend={onSend} onInsert={onInsert} />}
      {running && !turn.content && (!turn.steps || turn.steps.every((s) => s.status !== 'running')) && <Spinner label={t('common.thinking')} />}
      {turn.show === 'grammar' && turn.review
        ? <GrammarCard api={api} turn={turn} onApply={onApply} onReview={onReview} />
        : parts.map((part, i) => (
          part.kind === 'say'
            ? <SayPart key={i} api={api} mode={mode} turn={turn} text={part.text} onApply={onApply} />
            : part.kind === 'widget'
              ? (part.widget ? <Widget key={i} api={api} mode={mode} widget={part.widget} onSend={onSend} onInsert={onInsert} /> : null)
            : part.kind === 'actions'
              ? <ActionItems key={i} api={api} answer={part.text} />
              : part.kind === 'replies'
                ? <Replies key={i} api={api} answer={part.text} email={email} />
                : (
                  <ProposalCard
                    key={i}
                    api={api}
                    mode={mode}
                    turn={turn}
                    text={part.text}
                    streaming={running || part.open}
                    plain={part.plain}
                    onApply={onApply}
                  />
                )
        ))}
      {turn.status === 'stopped' && <Text tone="muted" size="xs">{t('common.stopped')}</Text>}
      {turn.status === 'error' && <ErrorMessage api={api} error={Object.assign(new AiError(turn.error?.code ?? 'unreachable', turn.error ?? {}), {})} onRetry={() => onRetry(turn)} />}
      {turn.applyFailed && <Alert tone="danger">{t('assistant.apply_failed')}</Alert>}
    </Stack>
    </div>
  );
}

/** What the model says. In the composer it can still go into the message when the model left the tags out. */
function SayPart({ api, mode, turn, text, onApply }) {
  const t = api.i18n.t;
  const offer = mode === 'composer' && turn.status === 'done' && turn.show === 'chat' && !turn.applied
    && !(turn.content ?? '').includes('<text') && text.split(/\s+/).length >= 12;
  // A summary, an explanation or a translation of a message: copyable.
  const copyable = mode === 'reader' && turn.status === 'done' && (turn.show === 'text' || turn.show === 'chat');
  return (
    <Stack gap={1}>
      <Markdown text={text} onOpenLink={(url) => void api.ui.openExternalUrl?.(url)} />
      {(offer || copyable) && (
        <Row>
          {offer && <LinkButton icon="text-plus" onClick={() => onApply(turn, 'cursor', stripMarkdown(text))}>{t('panel.insert_cursor')}</LinkButton>}
          {copyable && <LinkButton icon="copy" onClick={() => void copyWithToast(api, stripMarkdown(text))}>{t('common.copy')}</LinkButton>}
        </Row>
      )}
    </Stack>
  );
}

/** The pieces of an answer as the transcript shows them. */
export function partsOf(turn) {
  const text = turn.content ?? '';
  if (turn.show === 'actions') return turn.status === 'done' ? [{ kind: 'actions', text }] : [];
  if (turn.show === 'replies') return turn.status === 'done' ? [{ kind: 'replies', text }] : [];
  if (turn.show === 'text') return text ? [{ kind: 'say', text }] : [];
  if (turn.show === 'proposal') return text ? [{ kind: 'proposal', text, open: turn.status === 'running', plain: false }] : [];
  // The chat: proposals are tagged, the rest is talk.
  return proposalParts(text);
}

function proposalParts(text) {
  const out = [];
  for (const piece of (text ? parseAnswer(text) : [])) {
    if (piece.kind === 'say') out.push({ kind: 'say', text: piece.text });
    else if (piece.kind === 'widget') out.push({ kind: 'widget', widget: piece.widget, open: piece.open });
    else out.push({ kind: 'proposal', text: piece.text, open: piece.open, plain: false });
  }
  return out;
}

/** A proposal: the change marked against the text it replaces, and the buttons to take it. */
function ProposalCard({ api, mode, turn, text, streaming, onApply }) {
  const t = api.i18n.t;
  const source = turn.source ?? '';
  const scope = turn.scope;
  const composerEdit = mode === 'composer' && (scope === 'selection' || scope === 'body');
  const shown = streaming && composerEdit ? (/^\s*/.exec(source)[0] + text.replace(/^\s+/, '')) : (composerEdit ? (keepEdges(source, text) || text) : text);
  const parts = composerEdit ? diffWords(source, shown, { partial: streaming }) : plainParts(text.trim());
  const ready = !streaming && !!text.trim() && !turn.applying;
  const applied = turn.applied;
  const final = composerEdit ? (keepEdges(source, text) || text) : text;
  return (
    <div data-proposal>
    <Stack gap={2}>
      <DiffView parts={parts} streaming={streaming} label={t('assistant.preview_label')} />
      {applied ? (
        <Row gap={2}>
          <Badge tone="success">{t(applied === 'reply' ? 'panel.applied.reply' : applied === 'replace' ? 'panel.applied.replace' : 'panel.applied.insert')}</Badge>
          {applied !== 'reply' && <Text size="xs" tone="muted">{t('panel.undo_hint')}</Text>}
        </Row>
      ) : (
        <Row gap={1}>
          {mode === 'reader' ? (
            <Button size="sm" icon="arrow-back-up" disabled={!ready} busy={turn.applying === 'reply'} onClick={() => onApply(turn, 'reply', final)}>{t('panel.open_reply')}</Button>
          ) : scope === 'selection' ? (
            <>
              <Button size="sm" disabled={!ready} busy={turn.applying === 'replace'} onClick={() => onApply(turn, 'replace', final)}>{t('assistant.replace')}</Button>
              <Button size="sm" variant="secondary" disabled={!ready} busy={turn.applying === 'below'} onClick={() => onApply(turn, 'below', final)}>{t('assistant.insert_below')}</Button>
            </>
          ) : scope === 'body' ? (
            <>
              <Button size="sm" disabled={!ready} busy={turn.applying === 'replace'} onClick={() => onApply(turn, 'replace', final)}>{t('panel.replace_message')}</Button>
              <Button size="sm" variant="secondary" disabled={!ready} busy={turn.applying === 'cursor'} onClick={() => onApply(turn, 'cursor', final)}>{t('panel.insert_cursor')}</Button>
            </>
          ) : (
            <Button size="sm" disabled={!ready} busy={turn.applying === 'replace'} onClick={() => onApply(turn, 'replace', final)}>{t('assistant.insert')}</Button>
          )}
          <Button size="sm" variant="ghost" icon="copy" disabled={!ready} aria-label={t('common.copy')} title={t('common.copy')} onClick={() => void copyWithToast(api, final.trim())} />
        </Row>
      )}
    </Stack>
    </div>
  );
}

/** Spelling fixes, one by one or all at once. */
function GrammarCard({ api, turn, onApply, onReview }) {
  const t = api.i18n.t;
  const review = turn.review;
  const pending = pendingSuggestions(review.segments, review.states);
  const total = review.segments.filter((s) => s.kind === 'change').length;
  const accepted = Object.values(review.states).some((s) => s === 'accepted');
  const decide = (id, state) => onReview(reviewStep(review, id, state).review);
  const label = (s) => (s.from.trim() ? `${s.from.trim()} → ${s.to.trim() || '∅'}` : `+ ${s.to.trim()}`);
  if (total === 0) return <Alert tone="success" icon="check">{t('grammar.none')}</Alert>;
  return (
    <div data-proposal>
    <Stack gap={2}>
      <Text tone="muted" size="xs">{t('grammar.count', { open: pending.length, total })}</Text>
      <DiffView parts={reviewParts(review.segments, review.states)} label={t('assistant.preview_label')} />
      {pending.length > 0 && (
        <List label={t('assistant.suggestions')}>
          {pending.map((s) => (
            <ListRow
              key={s.id}
              title={label(s)}
              actions={(
                <>
                  <RowAction icon="check" label={t('grammar.accept_label', { from: s.from.trim(), to: s.to.trim() })} onClick={() => decide(s.id, 'accepted')} />
                  <RowAction icon="x" label={t('grammar.skip_label', { from: s.from.trim() })} onClick={() => decide(s.id, 'skipped')} />
                </>
              )}
            />
          ))}
        </List>
      )}
      {turn.applied ? (
        <Row gap={2}><Badge tone="success">{t('panel.applied.replace')}</Badge><Text size="xs" tone="muted">{t('panel.undo_hint')}</Text></Row>
      ) : (
        <Row gap={1}>
          <Button size="sm" disabled={!accepted || !!turn.applying} busy={!!turn.applying} onClick={() => onApply(turn, 'replace', applySuggestions(review.segments, review.states))}>{t('assistant.replace')}</Button>
          {pending.length > 1 && <Button size="sm" variant="secondary" onClick={() => onReview(acceptAll(review).review)}>{t('grammar.accept_all')}</Button>}
        </Row>
      )}
    </Stack>
    </div>
  );
}

/** One lookup the model made. */
const STEP_ICONS = { check_calendar: 'calendar', find_contact: 'address-book', search_mail: 'search', read_message: 'mail-opened', read_original_message: 'mail' };

function stepLabel(t, step) {
  const args = step.args ?? {};
  switch (step.name) {
    case 'check_calendar': return t('panel.step.check_calendar', { from: args.from ?? '', to: args.to ?? args.from ?? '' });
    case 'find_contact': return t('panel.step.find_contact', { query: args.query ?? '' });
    case 'read_original_message': return t('panel.step.read_original_message');
    case 'search_mail': return t('panel.step.search_mail', { query: [args.text, args.from, args.subject, args.after, args.before].filter(Boolean).join(' ') });
    case 'read_message': return t('panel.step.read_message');
    default: return step.name;
  }
}

/**
 * The lookups of one answer, in a box of their own: "Looked up" and a chip
 * per lookup (Mail, Calendar, Message), a spinner while they run. Clicking
 * the box opens the details with the cards of what was found.
 */
function StepsGroup({ api, mode, steps, running, onSend, onInsert }) {
  const t = api.i18n.t;
  const [open, setOpen] = useState(false);
  const busy = running && steps.some((s) => s.status === 'running');
  const failed = steps.some((s) => s.status === 'failed');
  const chips = [];
  for (const step of steps) {
    const label = t(`panel.steps.kind.${step.name}`);
    const prev = chips.find((c) => c.label === label);
    if (prev) { prev.count++; prev.status = step.status === 'failed' || prev.status === 'failed' ? 'failed' : step.status === 'running' ? 'running' : prev.status; }
    else chips.push({ label, count: 1, status: step.status });
  }
  return (
    <div data-steps={steps.length} data-steps-open={open || undefined} style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? t('panel.steps.hide') : t('panel.steps.show')}
        className="bk"
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 8px', background: 'none', border: 0, font: 'inherit', color: 'inherit', textAlign: 'start', cursor: 'pointer', flexWrap: 'wrap' }}
      >
        {busy ? <Spinner size="sm" /> : <Icon name={failed ? 'alert-circle' : 'list-search'} size="sm" className="text-muted-foreground" />}
        <Text size="xs" tone="muted">{busy ? t('panel.steps.running') : t('panel.steps.title')}</Text>
        {chips.map((c) => (
          <Badge key={c.label} tone={c.status === 'failed' ? 'danger' : c.status === 'running' ? 'info' : 'neutral'}>{c.label}{c.count > 1 ? ` ×${c.count}` : ''}</Badge>
        ))}
        <span style={{ marginInlineStart: 'auto' }}><Icon name={open ? 'chevron-up' : 'chevron-down'} size="sm" className="text-muted-foreground" /></span>
      </button>
      {open && (
        <div style={{ padding: '2px 8px 8px' }}>
          <Stack gap={2}>
            {steps.map((step) => <StepRow key={step.id} api={api} mode={mode} step={step} onSend={onSend} onInsert={onInsert} />)}
          </Stack>
        </div>
      )}
    </div>
  );
}

/** One lookup the model made, with a card of what it found. */
function StepRow({ api, mode, step, onSend, onInsert }) {
  const t = api.i18n.t;
  const icon = step.status === 'running' ? 'loader-2' : step.status === 'failed' ? 'alert-circle' : (STEP_ICONS[step.name] ?? 'mail');
  return (
    <div data-step={step.name} data-step-status={step.status} style={{ paddingTop: 6, borderTop: '1px solid var(--color-border)' }}>
    <Stack gap={1}>
      <Row gap={1} wrap={false} align="start">
        <Icon name={icon} size="sm" className="text-muted-foreground" />
        <Text size="xs" tone="muted">{stepLabel(t, step)}{step.status === 'failed' ? ` · ${t('panel.step.failed')}` : ''}</Text>
      </Row>
      {step.widget && <Widget api={api} mode={mode} widget={step.widget} onSend={onSend} onInsert={onInsert} />}
      {step.result && !step.widget && <Text size="xs" tone="muted" className="whitespace-pre-wrap">{step.result.slice(0, 1200)}</Text>}
    </Stack>
    </div>
  );
}
