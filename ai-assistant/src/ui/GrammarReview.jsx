// Grammar fixes shown in the text, each accepted or skipped on its own.

import { applySuggestions, pendingSuggestions } from '../lib/grammar.js';
import { t } from './common.jsx';

export function GrammarReview({ review, onAccept, onSkip, onAcceptAll, onDone }) {
  const { segments, states } = review;
  const pending = pendingSuggestions(segments, states);
  const total = segments.filter((s) => s.kind === 'change').length;
  return (
    <div className="ai-card" data-testid="ai-grammar">
      <div className="ai-head">
        <span className="ai-title">
          {total === 0 ? t('grammar.none') : t('grammar.count', { open: pending.length, total })}
        </span>
        <div className="ai-row">
          {pending.length > 1 && <button type="button" className="ai-btn small" onClick={onAcceptAll}>{t('grammar.accept_all')}</button>}
          <button type="button" className="ai-btn small ghost" onClick={onDone}>{t('grammar.done')}</button>
        </div>
      </div>
      {total > 0 && (
        <div className="ai-out">
          {segments.map((s, i) => {
            if (s.kind === 'same') return <span key={i}>{s.text}</span>;
            const state = states[s.id];
            if (state === 'accepted') return <span key={s.id}>{s.to}</span>;
            if (state === 'skipped') return <span key={s.id}>{s.from}</span>;
            return (
              <span key={s.id} className="ai-change" data-testid="ai-suggestion">
                {s.from && <del className="ai-from">{s.from}</del>}
                {s.to && <ins className="ai-to">{s.to}</ins>}
                <span className="ai-change-actions">
                  <button type="button" className="ai-btn small" aria-label={t('grammar.accept_label', { from: s.from.trim(), to: s.to.trim() })} onClick={() => onAccept(s.id)}>✓</button>
                  <button type="button" className="ai-btn small ghost" aria-label={t('grammar.skip_label', { from: s.from.trim() })} onClick={() => onSkip(s.id)}>✕</button>
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Review state after one action; `text` is what the user's text becomes. */
export function reviewStep(review, id, state) {
  const states = { ...review.states, [id]: state };
  return { review: { ...review, states }, text: applySuggestions(review.segments, states) };
}
