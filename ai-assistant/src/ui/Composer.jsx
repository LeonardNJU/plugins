// The composer: a button in the composer's plugin row opens the assistant
// in a dialog (works on phones too). The assistant works on a copy of the
// user's own text (without the quoted message), with undo, and the result
// is copied back: the webmail has no way yet for a plugin to change the
// text in the composer.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Styles, ConsentPrompt, ErrorMessage, Spark, StreamText, copyWithToast, host, t, useTask } from './common.jsx';
import { DRAFT_KEY } from '../lib/background.js';
import { createHistory, ownText } from '../lib/draft.js';
import { REWRITE_STYLES } from '../lib/prompts.js';
import { defaultTarget, languageOptions } from '../lib/languages.js';
import { loadPrefs, savePrefs } from '../lib/assistant.js';
import { diffSuggestions } from '../lib/grammar.js';
import { GrammarReview, reviewStep } from './GrammarReview.jsx';

export function ComposerButton() {
  return (
    <div className="ai">
      <Styles />
      <button
        type="button"
        className="ai-btn ghost small"
        onClick={() => void host().ui.openDialog({ title: t('composer.title'), slot: 'plugin-dialog', width: 680, extraProps: { view: 'composer' } })}
      >
        <Spark />{t('composer.open')}
      </button>
    </div>
  );
}

function useHistory() {
  const history = useRef(createHistory(''));
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  return {
    get text() { return history.current.current; },
    get canUndo() { return history.current.canUndo; },
    apply: (next) => { history.current.apply(next); bump(); },
    set: (next) => { history.current.set(next); bump(); },
    undo: () => { history.current.undo(); bump(); },
  };
}

export function ComposerDialog({ onResult }) {
  const api = host();
  const locale = api.i18n.getLocale?.() ?? 'en';
  const doc = useHistory();
  const task = useTask();
  const [subject, setSubject] = useState('');
  const [instruction, setInstruction] = useState('');
  const [style, setStyle] = useState('shorter');
  const [target, setTarget] = useState(defaultTarget(locale));
  const languages = useMemo(() => languageOptions(locale), [locale]);
  const ids = { text: useId(), prompt: useId(), style: useId(), target: useId() };
  // Grammar suggestions: { segments, states, order } while the user goes through them.
  const [review, setReview] = useState(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [draft, prefs] = await Promise.all([api.storage.get(DRAFT_KEY), loadPrefs(api)]);
      if (!live) return;
      if (draft?.text) doc.set(ownText(draft.text));
      if (draft?.subject) setSubject(draft.subject);
      setTarget(defaultTarget(locale, prefs.translateTo));
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (task.task !== 'grammar' || task.status !== 'done') return;
    setReview({ segments: diffSuggestions(doc.text, task.text.replace(/^\s+|\s+$/g, '') || doc.text), states: {}, order: [] });
    task.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.status, task.task]);

  const decide = (id, state) => {
    const step = reviewStep(review, id, state);
    if (state === 'accepted') {
      doc.apply(step.text);
      setReview({ ...step.review, order: [...review.order, id] });
    } else {
      setReview({ ...step.review, order: review.order });
    }
  };
  const acceptAll = () => {
    let next = review;
    let text = doc.text;
    const ids = [];
    for (const seg of review.segments) {
      if (seg.kind !== 'change' || review.states[seg.id]) continue;
      ({ review: next, text } = reviewStep(next, seg.id, 'accepted'));
      ids.push(seg.id);
    }
    doc.apply(text);
    setReview({ ...next, order: [...review.order, ids] });
  };
  const undo = () => {
    if (review && review.order.length) {
      const last = review.order[review.order.length - 1];
      const states = { ...review.states };
      for (const id of [].concat(last)) delete states[id];
      setReview({ ...review, states, order: review.order.slice(0, -1) });
    }
    doc.undo();
  };

  const running = task.status === 'running';
  const hasText = doc.text.trim().length > 0;
  const showResult = task.status !== 'idle';

  const start = (name, input) => void task.run(name, input);
  const useResult = () => {
    doc.apply(task.text.trim());
    task.reset();
  };

  return (
    <div className="ai" style={{ display: 'grid', gap: 12, padding: 2 }}>
      <Styles />
      <div>
        <label className="ai-label" htmlFor={ids.text}>{t('composer.your_text')}</label>
        <textarea
          id={ids.text}
          className="ai-text"
          rows={8}
          value={doc.text}
          readOnly={!!review}
          placeholder={t('composer.text_placeholder')}
          onChange={(e) => doc.set(e.target.value)}
        />
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div className="ai-row">
          <label className="ai-sr" htmlFor={ids.prompt}>{t('composer.prompt_label')}</label>
          <input
            id={ids.prompt}
            className="ai-input"
            style={{ flex: '1 1 240px' }}
            value={instruction}
            placeholder={t('composer.prompt_placeholder')}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && instruction.trim() && !running) start('write', { prompt: instruction.trim(), subject, text: doc.text });
            }}
          />
          <button type="button" className="ai-btn primary" disabled={!instruction.trim() || running} onClick={() => start('write', { prompt: instruction.trim(), subject, text: doc.text })}>
            {t('composer.write')}
          </button>
        </div>
        <div className="ai-row">
          <label className="ai-sr" htmlFor={ids.style}>{t('composer.rewrite_label')}</label>
          <select id={ids.style} className="ai-select" value={style} onChange={(e) => setStyle(e.target.value)}>
            {REWRITE_STYLES.map((s) => <option key={s} value={s}>{t(`composer.style.${s}`)}</option>)}
          </select>
          <button type="button" className="ai-btn" disabled={!hasText || running} onClick={() => start('rewrite', { text: doc.text, style })}>{t('composer.rewrite')}</button>
          <span style={{ width: 8 }} aria-hidden="true" />
          <label className="ai-sr" htmlFor={ids.target}>{t('composer.translate_label')}</label>
          <select
            id={ids.target}
            className="ai-select"
            value={target}
            onChange={(e) => { setTarget(e.target.value); void savePrefs(api, { translateTo: e.target.value }); }}
          >
            {languages.map((l) => <option key={l.tag} value={l.tag}>{l.label}</option>)}
          </select>
          <button type="button" className="ai-btn" disabled={!hasText || running} onClick={() => start('translate', { text: doc.text, target })}>{t('composer.translate')}</button>
        </div>
        <div className="ai-row">
          <button type="button" className="ai-btn" disabled={!hasText || running || !!review} onClick={() => start('grammar', { text: doc.text })}>{t('grammar.check')}</button>
        </div>
      </div>

      <ConsentPrompt consent={task.consent} />
      {review && (
        <GrammarReview
          review={review}
          onAccept={(id) => decide(id, 'accepted')}
          onSkip={(id) => decide(id, 'skipped')}
          onAcceptAll={acceptAll}
          onDone={() => setReview(null)}
        />
      )}
      {showResult && !task.consent && (
        <div className="ai-card" data-testid="ai-result">
          <div className="ai-head">
            <span className="ai-title">{t(`composer.result.${task.task}`)}</span>
            <div className="ai-row">
              {running && <button type="button" className="ai-btn small" onClick={task.cancel}>{t('common.stop')}</button>}
              {!running && task.text && task.status !== 'error' && (
                <button type="button" className="ai-btn small primary" onClick={useResult}>{t('composer.use')}</button>
              )}
              {!running && <button type="button" className="ai-btn small ghost" onClick={task.reset}>{t('composer.discard')}</button>}
            </div>
          </div>
          {(task.text || running) && <StreamText text={task.text} running={running} />}
          {task.status === 'stopped' && <div className="ai-muted" style={{ padding: '0 12px 8px' }}>{t('common.stopped')}</div>}
          {task.status === 'error' && <ErrorMessage error={task.error} onRetry={() => start(task.task, retryInput(task.task, { instruction, subject, doc, style, target }))} />}
        </div>
      )}

      <div className="ai-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="ai-btn" disabled={!doc.canUndo || running} onClick={undo}>{t('composer.undo')}</button>
        <div className="ai-row">
          <button
            type="button"
            className="ai-btn primary"
            disabled={!hasText}
            onClick={async () => {
              if (await copyWithToast(doc.text, 'composer.copied')) onResult?.({ copied: true });
            }}
          >
            {t('composer.copy')}
          </button>
        </div>
      </div>
      <div className="ai-muted">{t('composer.paste_hint')}</div>
    </div>
  );
}

function retryInput(name, { instruction, subject, doc, style, target }) {
  if (name === 'write') return { prompt: instruction.trim(), subject, text: doc.text };
  if (name === 'rewrite') return { text: doc.text, style };
  if (name === 'translate') return { text: doc.text, target };
  return { text: doc.text };
}
