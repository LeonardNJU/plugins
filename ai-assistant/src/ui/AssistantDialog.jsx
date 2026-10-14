// The assistant dialog, opened from the composer's Assistant button (or
// Alt+A) for one composer. It works on the selected text, or on the whole
// message when nothing is selected (the host leaves out the signature and
// the quoted email). The user picks what to do, sees the answer come in as
// a marked change, and replaces the text or inserts the answer below it.
// Every change is one step in the composer's undo. An empty message gets
// the "write" flow instead: describe the email, insert what comes back.

import { useEffect, useMemo, useState } from 'react';
import {
  DialogButtons, DiffView, Field, LinkButton, List, ListRow, Loading, Alert,
  Row, RowAction, Segmented, Select, Stack, Text, Textarea,
} from '@plugin-host/ui';
import { ConsentNotice, ErrorMessage, useApi, useTask } from './common.jsx';
import { DRAFT_KEY } from '../lib/background.js';
import { REWRITE_STYLES } from '../lib/prompts.js';
import { defaultTarget, languageOptions } from '../lib/languages.js';
import { loadPrefs, savePrefs } from '../lib/assistant.js';
import { acceptAll, applySuggestions, diffSuggestions, pendingSuggestions, reviewParts, reviewStep } from '../lib/grammar.js';
import { diffWords, plainParts } from '../lib/diff.js';

/** What the user can ask for, in the order shown. */
export const ACTIONS = [...REWRITE_STYLES, 'grammar', 'translate', 'custom'];

/** The task and its input for an action on `text`. */
export function taskFor(action, { text, target, instruction }) {
  if (REWRITE_STYLES.includes(action)) return ['rewrite', { text, style: action }];
  if (action === 'translate') return ['translate', { text, target }];
  if (action === 'custom') return ['edit', { text, instruction: instruction.trim() }];
  return ['grammar', { text }];
}

/** The answer with the spaces around the original kept, so a replaced word still has its neighbours' spacing. */
export function keepEdges(original, answer) {
  const lead = /^\s*/.exec(original)[0];
  const trail = /\s*$/.exec(original)[0];
  const core = String(answer ?? '').trim();
  return core ? lead + core + trail : '';
}

const excerpt = (text, max = 140) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Read what the dialog works on: the selection, else the user's own text. */
async function readSource(api, composerId) {
  const selection = await api.composer.getSelection(composerId);
  if (selection && !selection.empty && selection.text?.trim()) return { scope: 'selection', text: selection.text };
  const body = await api.composer.getBody(composerId);
  return { scope: 'body', text: body?.text ?? '' };
}

export function AssistantDialog(props) {
  const { composerId, onResult } = props;
  const api = useApi(props);
  const t = api.i18n.t;
  const locale = api.i18n.getLocale?.() ?? 'en';
  const task = useTask(api, { inlineConsent: true });
  const languages = useMemo(() => languageOptions(locale), [locale]);

  const [source, setSource] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [subject, setSubject] = useState('');
  const [action, setAction] = useState('improve');
  const [target, setTarget] = useState(defaultTarget(locale));
  const [instruction, setInstruction] = useState('');
  const [prompt, setPrompt] = useState('');
  // Grammar suggestions: { segments, states } while the user goes through them.
  const [review, setReview] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [read, prefs, draft] = await Promise.all([
          readSource(api, composerId),
          loadPrefs(api),
          api.storage.get(DRAFT_KEY).catch(() => null),
        ]);
        if (!live) return;
        setSource(read);
        setTarget(defaultTarget(locale, prefs.translateTo));
        if (prefs.lastAction && ACTIONS.includes(prefs.lastAction) && prefs.lastAction !== 'custom') setAction(prefs.lastAction);
        if (typeof draft?.subject === 'string') setSubject(draft.subject);
      } catch (err) {
        api.log?.warn?.('could not read the composer', err?.message ?? err);
        if (live) setLoadError(true);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerId]);

  const writing = !!source && !source.text.trim();
  const running = task.status === 'running';

  // A finished grammar check turns into suggestions to go through.
  useEffect(() => {
    if (task.task !== 'grammar' || task.status !== 'done' || !source) return;
    const corrected = keepEdges(source.text, task.text) || source.text;
    setReview({ segments: diffSuggestions(source.text, corrected), states: {} });
    task.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.status, task.task]);

  const start = () => {
    setApplyFailed(false);
    if (writing) {
      void task.run('write', { prompt: prompt.trim(), subject });
      return;
    }
    const [name, input] = taskFor(action, { text: source.text, target, instruction });
    void savePrefs(api, { lastAction: action });
    void task.run(name, input);
  };

  const backToChoice = () => {
    task.reset();
    setReview(null);
    setApplyFailed(false);
  };

  const apply = async (how, text) => {
    setApplying(true);
    setApplyFailed(false);
    try {
      let ok;
      if (how === 'below') ok = await api.composer.replaceSelection(composerId, { text: text.trim() }, { below: true });
      else if (source.scope === 'selection') ok = await api.composer.replaceSelection(composerId, { text });
      else ok = await api.composer.replaceBody(composerId, { text: text.trim() });
      if (ok === false) throw new Error('refused');
      onResult?.({ applied: how });
    } catch (err) {
      api.log?.warn?.('could not change the message', err?.message ?? err);
      setApplyFailed(true);
    } finally {
      setApplying(false);
    }
  };

  // ─── What the body shows, and the footer buttons for it ────────
  let body;
  let buttons;
  let onButton;

  if (loadError) {
    body = <Alert tone="danger">{t('assistant.composer_gone')}</Alert>;
    buttons = [{ id: 'close', label: t('common.close'), variant: 'secondary' }];
    onButton = () => onResult?.(null);
  } else if (!source) {
    body = <Loading label={t('common.loading')} />;
    buttons = [{ id: 'cancel', label: t('common.cancel'), variant: 'secondary' }];
    onButton = () => onResult?.(null);
  } else if (task.consent) {
    body = <ConsentNotice api={api} consent={task.consent} />;
    buttons = [
      { id: 'decline', label: t('common.cancel'), variant: 'secondary' },
      { id: 'continue', label: t('privacy.continue'), variant: 'primary' },
    ];
    onButton = (id) => task.consent?.answer(id === 'continue');
  } else if (review) {
    const pending = pendingSuggestions(review.segments, review.states);
    const total = review.segments.filter((s) => s.kind === 'change').length;
    const accepted = Object.values(review.states).some((s) => s === 'accepted');
    const decide = (id, state) => setReview(reviewStep(review, id, state).review);
    const label = (s) => (s.from.trim() ? `${s.from.trim()} → ${s.to.trim() || '∅'}` : `+ ${s.to.trim()}`);
    body = total === 0
      ? <Alert tone="success" icon="check">{t('grammar.none')}</Alert>
      : (
        <Stack gap={4}>
          <Text tone="muted">{t('grammar.count', { open: pending.length, total })}</Text>
          <DiffView parts={reviewParts(review.segments, review.states)} label={t('assistant.preview_label')} />
          {pending.length > 0 && (
            <Stack gap={2}>
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
              {pending.length > 1 && <Row><LinkButton icon="checks" onClick={() => setReview(acceptAll(review).review)}>{t('grammar.accept_all')}</LinkButton></Row>}
            </Stack>
          )}
          {applyFailed && <Alert tone="danger">{t('assistant.apply_failed')}</Alert>}
        </Stack>
      );
    buttons = total === 0
      ? [{ id: 'discard', label: t('composer.discard'), variant: 'secondary' }, { id: 'close', label: t('common.close'), variant: 'primary' }]
      : [
        { id: 'discard', label: t('composer.discard'), variant: 'secondary' },
        { id: 'replace', label: t('assistant.replace'), variant: 'primary', disabled: !accepted, busy: applying },
      ];
    onButton = (id) => {
      if (id === 'discard') backToChoice();
      else if (id === 'close') onResult?.(null);
      else if (id === 'replace') {
        void apply('replace', applySuggestions(review.segments, review.states));
      }
    };
  } else if (task.status !== 'idle') {
    const answer = task.status === 'done' ? keepEdges(source.text, task.text) : '';
    const shown = running ? (/^\s*/.exec(source.text)[0] + task.text.replace(/^\s+/, '')) : (answer || task.text);
    const parts = writing ? plainParts(task.text.trim()) : diffWords(source.text, shown, { partial: running || task.status !== 'done' });
    const ready = task.status === 'done' && !!answer && !applying;
    body = (
      <Stack gap={4}>
        <Text weight="medium">{t(`composer.result.${task.task}`)}</Text>
        {(running || task.text) && (
          running && !task.text
            ? <Loading label={t('common.thinking')} />
            : <DiffView parts={parts} streaming={running} label={t('assistant.preview_label')} />
        )}
        {task.status === 'stopped' && <Text tone="muted">{t('common.stopped')}</Text>}
        {task.status === 'error' && <ErrorMessage api={api} error={task.error} onRetry={start} />}
        {applyFailed && <Alert tone="danger">{t('assistant.apply_failed')}</Alert>}
      </Stack>
    );
    buttons = writing
      ? [
        { id: 'discard', label: t('composer.discard'), variant: 'secondary' },
        { id: 'insert', label: t('assistant.insert'), variant: 'primary', disabled: !ready, busy: applying },
      ]
      : [
        { id: 'discard', label: t('composer.discard'), variant: 'secondary' },
        ...(task.task === 'grammar' ? [] : [{ id: 'below', label: t('assistant.insert_below'), variant: 'secondary', disabled: !ready }]),
        { id: 'replace', label: t('assistant.replace'), variant: 'primary', disabled: !ready, busy: applying },
      ];
    onButton = (id) => {
      if (id === 'discard') backToChoice();
      else if (id === 'insert') void apply('replace', answer);
      else if (id === 'below') void apply('below', answer);
      else if (id === 'replace') void apply('replace', answer);
    };
  } else if (writing) {
    body = (
      <Stack gap={4}>
        <Text tone="muted">{t('assistant.empty_hint')}</Text>
        <Field label={t('composer.prompt_label')}>
          <Textarea
            rows={4}
            value={prompt}
            placeholder={t('composer.prompt_placeholder')}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
        </Field>
      </Stack>
    );
    buttons = [
      { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
      { id: 'go', label: t('composer.write'), variant: 'primary', disabled: !prompt.trim() },
    ];
    onButton = (id) => (id === 'go' ? start() : onResult?.(null));
  } else {
    const goLabel = action === 'translate' ? t('composer.translate') : action === 'grammar' ? t('grammar.check') : t('composer.rewrite');
    body = (
      <Stack gap={4}>
        <Stack gap={1}>
          <Text tone="muted">{t(source.scope === 'selection' ? 'assistant.scope_selection' : 'assistant.scope_body')}</Text>
          <Text>{excerpt(source.text)}</Text>
        </Stack>
        <Field label={t('assistant.action_label')}>
          <Segmented
            value={action}
            label={t('assistant.action_label')}
            options={ACTIONS.map((a) => ({ value: a, label: t(`assistant.action.${a}`) }))}
            onChange={setAction}
          />
        </Field>
        {action === 'translate' && (
          <Field label={t('composer.translate_label')}>
            <Select
              block
              value={target}
              options={languages.map((l) => ({ value: l.tag, label: l.label }))}
              onChange={(value) => { setTarget(value); void savePrefs(api, { translateTo: value }); }}
            />
          </Field>
        )}
        {action === 'custom' && (
          <Field label={t('assistant.instruction_label')}>
            <Textarea
              rows={3}
              value={instruction}
              placeholder={t('assistant.instruction_placeholder')}
              onChange={(e) => setInstruction(e.target.value)}
              autoFocus
            />
          </Field>
        )}
      </Stack>
    );
    buttons = [
      { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
      { id: 'go', label: goLabel, variant: 'primary', disabled: action === 'custom' && !instruction.trim() },
    ];
    onButton = (id) => (id === 'go' ? start() : onResult?.(null));
  }

  return (
    <>
      {body}
      <DialogButtons buttons={buttons} onClick={(id) => onButton(id)} />
    </>
  );
}
