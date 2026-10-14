// The note UI, drawn with the app's UI kit:
//   - NoteBanner: a one-line reader info bar ("This email has a note").
//   - the side panel next to the open message: heading, the note as the
//     kit's textarea, when it was saved.
// Every visible string comes from the manifest's locales via api.i18n.t.
// Built from a factory so tests can hand in React and a fake api.

import { EmptyState, Field, Heading, InfoBar, Page, Row, Stack, Text, Textarea } from '@plugin-host/ui';

export const SAVE_DELAY_MS = 500;

/** Stores `text` for `emailId` in the notes map, keeping the newest `maxNotes`. */
export function withNote(map, emailId, text, maxNotes, now = new Date()) {
  const next = map && typeof map === 'object' ? { ...map } : {};
  if (!text.trim()) {
    delete next[emailId];
    return next;
  }
  next[emailId] = { text, updatedAt: now.toISOString() };
  const ids = Object.keys(next);
  if (ids.length > maxNotes) {
    const oldest = ids
      .map((id) => ({ id, t: next[id]?.updatedAt || '' }))
      .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
      .slice(0, ids.length - maxNotes);
    for (const { id } of oldest) delete next[id];
  }
  return next;
}

export function makeNoteBanner(React, api) {
  return function NoteBanner() {
    return React.createElement(InfoBar, { compact: true, tone: 'primary', icon: 'note', title: api.i18n.t('banner.title') });
  };
}

export function makeNotesPanel(React, api) {
  const { createElement: h, useCallback, useEffect, useRef, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);
  const locale = () => (api.i18n.getLocale && api.i18n.getLocale()) || undefined;

  return function NotesPanel(props) {
    const emailId = props?.email?.id || null;
    const [text, setText] = useState('');
    const [savedAt, setSavedAt] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const debounceRef = useRef(null);

    // Load this email's note whenever the open email changes.
    useEffect(() => {
      setLoaded(false);
      if (!emailId) {
        setText('');
        setSavedAt(null);
        setLoaded(true);
        return undefined;
      }
      let cancelled = false;
      (async () => {
        try {
          const stored = (await api.storage.get('notes')) || {};
          if (cancelled) return;
          const entry = stored && typeof stored === 'object' ? stored[emailId] : null;
          setText(entry?.text || '');
          setSavedAt(entry?.updatedAt || null);
        } catch (err) {
          api.log.warn('quick-notes: could not load notes', err);
        } finally {
          if (!cancelled) setLoaded(true);
        }
      })();
      return () => { cancelled = true; };
    }, [emailId]);

    const persist = useCallback(async (nextText) => {
      if (!emailId) return;
      try {
        const stored = (await api.storage.get('notes')) || {};
        const maxNotes = Number(api.plugin?.settings?.maxNotes) || 100;
        const map = withNote(stored, emailId, nextText, maxNotes);
        await api.storage.set('notes', map);
        setSavedAt(map[emailId]?.updatedAt || null);
      } catch (err) {
        api.log.warn('quick-notes: save failed', err);
      }
    }, [emailId]);

    const onChange = useCallback((ev) => {
      const next = ev.target.value;
      setText(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { void persist(next); }, SAVE_DELAY_MS);
    }, [persist]);

    useEffect(() => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    }, [emailId]);

    if (!emailId) {
      return h(EmptyState, { compact: true, icon: 'note', title: t('panel.title'), description: t('panel.empty') });
    }

    return h(Page, null, h(Stack, { gap: 3 },
      h(Row, { justify: 'between', align: 'baseline' },
        h(Heading, { level: 3 }, t('panel.title')),
        savedAt ? h(Text, { size: 'xs', tone: 'muted' }, t('panel.saved', { time: new Date(savedAt).toLocaleTimeString(locale()) })) : null),
      h(Field, { label: t('panel.label'), hint: t('panel.hint') },
        h(Textarea, {
          value: loaded ? text : '',
          onChange,
          disabled: !loaded,
          placeholder: t('panel.placeholder'),
          rows: 8,
        })),
    ));
  };
}
