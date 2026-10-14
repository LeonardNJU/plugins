// The reader: a small bar above the message with Summarise, To-dos and
// dates, and Reply ideas; and a summary of a whole conversation above it.
// Nothing is sent until one of the buttons is clicked.

import { useEffect, useState } from 'react';
import { Styles, ConsentPrompt, ErrorMessage, Spark, StreamText, copyWithToast, host, t, useTask } from './common.jsx';
import { formatActionItems, parseActionItems, parseReplies } from '../lib/parse.js';
import { ownText } from '../lib/draft.js';

/** The fields of a message the prompts use. */
export function emailForPrompt(email) {
  return {
    from: email.from?.[0] ?? null,
    date: email.receivedAt ?? '',
    subject: email.subject ?? '',
    text: email.text ?? '',
  };
}

async function loadText(email) {
  if (email.text) return email;
  const full = await host().email.get(email.id);
  return { ...email, text: full?.text ?? email.preview ?? '' };
}

const READER_TASKS = ['summary', 'actions', 'replies'];

export function ReaderBar({ email }) {
  const task = useTask();
  const emailId = email?.id;
  // A new message: forget the old result.
  useEffect(() => { task.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [emailId]);
  if (!email) return null;

  const run = async (name) => {
    const full = await loadText(email);
    await task.run(name, { email: emailForPrompt(full), today: new Date().toISOString().slice(0, 10) });
  };
  const running = task.status === 'running';

  return (
    <div className="ai" style={{ padding: '4px 0' }}>
      <Styles />
      <div className="ai-row" role="toolbar" aria-label={t('reader.toolbar')}>
        <span className="ai-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Spark />{t('reader.label')}</span>
        {READER_TASKS.map((name) => (
          <button
            key={name}
            type="button"
            className="ai-btn small"
            aria-pressed={task.task === name && task.status !== 'idle'}
            disabled={running}
            onClick={() => void run(name)}
          >
            {t(`reader.${name}`)}
          </button>
        ))}
      </div>
      <ConsentPrompt consent={task.consent} />
      {task.status !== 'idle' && !task.consent && (
        <ReaderResult task={task} onRetry={() => void run(task.task)} />
      )}
    </div>
  );
}

function ReaderResult({ task, onRetry }) {
  const running = task.status === 'running';
  const done = task.status === 'done' || task.status === 'stopped';
  const structured = task.task === 'actions' || task.task === 'replies';
  return (
    <div className="ai-card" style={{ marginTop: 6 }} data-testid="ai-reader-result">
      <div className="ai-head">
        <span className="ai-title">{t(`reader.result.${task.task}`)}</span>
        <div className="ai-row">
          {running && <button type="button" className="ai-btn small" onClick={task.cancel}>{t('common.stop')}</button>}
          {done && task.task === 'summary' && (
            <button type="button" className="ai-btn small" onClick={() => void copyWithToast(task.text.trim())}>{t('common.copy')}</button>
          )}
          {!running && <button type="button" className="ai-btn small ghost" aria-label={t('common.close')} onClick={task.reset}>✕</button>}
        </div>
      </div>
      {(running || (!structured && task.text)) && (
        <StreamText text={running && structured ? '' : task.text} running={running} />
      )}
      {done && task.task === 'actions' && <ActionItems answer={task.text} />}
      {done && task.task === 'replies' && <Replies answer={task.text} />}
      {task.status === 'stopped' && <div className="ai-muted" style={{ padding: '0 12px 8px' }}>{t('common.stopped')}</div>}
      {task.status === 'error' && <ErrorMessage error={task.error} onRetry={onRetry} />}
    </div>
  );
}

function ActionItems({ answer }) {
  const items = parseActionItems(answer);
  if (!items.tasks.length && !items.dates.length) {
    return <div className="ai-out ai-muted">{t('reader.nothing_to_do')}</div>;
  }
  const copy = () => copyWithToast(formatActionItems(items, { tasksTitle: t('reader.todos'), datesTitle: t('reader.dates') }));
  return (
    <div>
      {items.tasks.length > 0 && (
        <>
          <div className="ai-section">{t('reader.todos')}</div>
          <ul className="ai-list" data-testid="ai-todos">
            {items.tasks.map((item, i) => (
              <li key={i}>{item.text}{item.due && <span className="ai-muted"> · {formatDate(item.due)}</span>}</li>
            ))}
          </ul>
        </>
      )}
      {items.dates.length > 0 && (
        <>
          <div className="ai-section">{t('reader.dates')}</div>
          <ul className="ai-list" data-testid="ai-dates">
            {items.dates.map((item, i) => (
              <li key={i}>{item.date && <strong>{formatDate(item.date, item.time)}: </strong>}{item.text}</li>
            ))}
          </ul>
        </>
      )}
      <div className="ai-row" style={{ padding: '0 12px 10px' }}>
        <button type="button" className="ai-btn small" onClick={() => void copy()}>{t('reader.copy_list')}</button>
        <span className="ai-muted">{t('reader.tasks_hint')}</span>
      </div>
    </div>
  );
}

function formatDate(date, time) {
  try {
    const value = new Date(`${date}T${time ?? '12:00'}:00`);
    const locale = host().i18n.getLocale?.() ?? 'en';
    return new Intl.DateTimeFormat(locale, time
      ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', day: 'numeric', month: 'short' }).format(value);
  } catch {
    return [date, time].filter(Boolean).join(' ');
  }
}

function Replies({ answer }) {
  const replies = parseReplies(answer);
  return (
    <div style={{ display: 'grid', gap: 6, padding: '8px 12px 10px' }}>
      {replies.map((reply, i) => (
        <div key={i} className="ai-card" style={{ padding: '8px 10px', display: 'grid', gap: 6 }} data-testid="ai-reply">
          <div style={{ whiteSpace: 'pre-wrap' }}>{reply}</div>
          <div className="ai-row">
            <button type="button" className="ai-btn small" onClick={() => void copyWithToast(reply, 'reader.reply_copied')}>{t('reader.use_reply')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Most recent messages first are cut when a conversation is very long. */
const MAX_THREAD_MESSAGES = 20;

export function ThreadSummary({ emailIds }) {
  const task = useTask();
  const [loading, setLoading] = useState(false);
  const key = (emailIds ?? []).join(',');
  useEffect(() => { task.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  if (!Array.isArray(emailIds) || emailIds.length < 2) return null;

  const run = async () => {
    setLoading(true);
    try {
      const ids = emailIds.slice(-MAX_THREAD_MESSAGES);
      const emails = (await Promise.all(ids.map((id) => host().email.get(id).catch(() => null)))).filter(Boolean);
      const input = emails.map((e) => ({ ...emailForPrompt(e), text: ownText(e.text ?? '') || e.preview || '' }));
      await task.run('thread', { emails: input });
    } finally {
      setLoading(false);
    }
  };
  const running = task.status === 'running' || loading;

  return (
    <div className="ai" style={{ padding: '4px 0' }}>
      <Styles />
      {task.status === 'idle' && (
        <button type="button" className="ai-btn small" disabled={running} onClick={() => void run()}>
          <Spark />{t('thread.summarize', { count: emailIds.length })}
        </button>
      )}
      <ConsentPrompt consent={task.consent} />
      {task.status !== 'idle' && !task.consent && (
        <div className="ai-card" data-testid="ai-thread-result">
          <div className="ai-head">
            <span className="ai-title">{t('thread.title', { count: emailIds.length })}</span>
            <div className="ai-row">
              {task.status === 'running' && <button type="button" className="ai-btn small" onClick={task.cancel}>{t('common.stop')}</button>}
              {task.status === 'done' && <button type="button" className="ai-btn small" onClick={() => void copyWithToast(task.text.trim())}>{t('common.copy')}</button>}
              {task.status !== 'running' && <button type="button" className="ai-btn small ghost" aria-label={t('common.close')} onClick={task.reset}>✕</button>}
            </div>
          </div>
          {(task.text || task.status === 'running') && <StreamText text={task.text} running={task.status === 'running'} />}
          {task.status === 'stopped' && <div className="ai-muted" style={{ padding: '0 12px 8px' }}>{t('common.stopped')}</div>}
          {task.status === 'error' && <ErrorMessage error={task.error} onRetry={() => void run()} />}
        </div>
      )}
    </div>
  );
}
