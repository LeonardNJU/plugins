// The translate bar above the message body: the kit's reader InfoBar (like
// "External content" or an invitation) with bar buttons, and the
// translation below a divider once it is there. Built from a factory so
// tests can hand in React and a fake api.

import { BarButton, Divider, InfoBar, Stack, Text } from '@plugin-host/ui';

export const FALLBACK_TARGET = 'en';
export const FALLBACK_PROVIDER = 'mymemory';
export const FALLBACK_MAX_CHARS = 4000;

function stripHtml(html) {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, head').forEach((el) => el.remove());
    return (doc.body?.textContent || '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

export function pickPlainText(email, maxChars) {
  if (!email) return '';
  const raw =
    (typeof email.text === 'string' && email.text.trim())
      ? email.text
      : (typeof email.preview === 'string' && email.preview.trim())
        ? email.preview
        : (email.body && typeof email.body.text === 'string' && email.body.text.trim())
          ? email.body.text
          : stripHtml(email.body?.html || email.htmlBody || '');
  const trimmed = String(raw || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

export function makeTranslateBanner(React, api) {
  const { createElement: h, useCallback, useEffect, useRef, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  async function callTranslate({ text, target, provider }) {
    const result = await api.http.post('/api/translate', { text, target, source: 'auto', provider });
    if (!result || !result.ok) {
      throw new Error(result?.data?.error || `HTTP ${result?.status ?? '???'}`);
    }
    return result.data || {};
  }

  // Paragraphs as Text blocks, single line breaks kept.
  function Translation({ text }) {
    const paragraphs = text.split(/\n{2,}/);
    return h(Stack, { gap: 2 }, ...paragraphs.map((p, i) => h(Text, { key: i },
      ...p.split('\n').flatMap((line, j) => (j === 0 ? [line] : [h('br', { key: j }), line])))));
  }

  return function TranslateBanner(props) {
    const settings = api.plugin?.settings || {};
    const target = String(settings.targetLanguage || FALLBACK_TARGET).toLowerCase();
    const provider = String(settings.provider || FALLBACK_PROVIDER);
    const maxChars = Number(settings.maxChars) || FALLBACK_MAX_CHARS;
    const autoTranslate = settings.autoTranslateForeign === true;

    const [state, setState] = useState({ status: 'idle' });
    const autoFiredRef = useRef(false);

    const run = useCallback(async () => {
      setState({ status: 'loading' });
      try {
        const source = pickPlainText(props.email, maxChars);
        if (!source) {
          setState({ status: 'error', error: t('error.no_text') });
          return;
        }
        const result = await callTranslate({ text: source, target, provider });
        const detected = result && typeof result === 'object' && 'detectedSource' in result ? result.detectedSource : undefined;
        if (detected && String(detected).toLowerCase().split('-')[0] === target.split('-')[0]) {
          setState({ status: 'skipped', detected });
          return;
        }
        setState({
          status: 'done',
          translated: String(result.translatedText || ''),
          detected,
          truncated: source.length >= maxChars,
        });
      } catch (err) {
        setState({ status: 'error', error: err && err.message ? err.message : String(err) });
      }
    }, [props.email, target, provider, maxChars]);

    // Auto-translate once per banner mount if enabled.
    useEffect(() => {
      if (!autoTranslate || autoFiredRef.current) return;
      autoFiredRef.current = true;
      void run();
    }, [autoTranslate, run]);

    const TARGET = target.toUpperCase();
    let title;
    if (state.status === 'idle') title = t('idle', { target: TARGET });
    else if (state.status === 'loading') title = t('translating');
    else if (state.status === 'skipped') title = t('skipped', { target: TARGET });
    else if (state.status === 'done') {
      title = t('done', { source: state.detected ? String(state.detected).toUpperCase() : t('source_auto'), target: TARGET })
        + (state.truncated ? t('truncated') : '');
    } else if (state.status === 'error') title = h(Text, { tone: 'danger', weight: 'medium' }, state.error);

    const button = state.status === 'idle' || state.status === 'loading'
      ? h(BarButton, { icon: 'language', busy: state.status === 'loading', onClick: run }, t('action.translate'))
      : h(BarButton, { icon: 'refresh', onClick: run }, t('action.again'));

    return h(InfoBar, { tone: 'info', icon: 'language', eyebrow: t('label'), title },
      button,
      state.status === 'done' ? h(Divider) : null,
      state.status === 'done' ? h(Translation, { text: state.translated }) : null);
  };
}
