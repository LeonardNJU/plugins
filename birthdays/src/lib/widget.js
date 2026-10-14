// The sidebar widget: upcoming birthdays from the user's contacts. Built
// from a factory so tests can hand in React and a fake api; src/index.js
// passes the real ones.

import { birthdaysFromContacts, upcomingBirthdays } from './contacts.js';
import { localToday } from './dates.js';
import { errorText, whenLine } from './format.js';
import { readSettings } from './settings.js';

/** Rows shown before "Show all". */
export const COLLAPSED_ROWS = 5;
/** How often an open widget reloads the contacts. */
export const REFRESH_MS = 10 * 60 * 1000;

const styles = {
  root: { padding: '8px 12px 10px', fontSize: '13px', color: 'var(--color-foreground)', lineHeight: 1.35 },
  heading: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600, color: 'var(--color-muted-foreground)' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  text: { flex: '1 1 auto', minWidth: 0 },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 },
  when: { fontSize: '12px', color: 'var(--color-muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  today: { color: 'var(--color-primary)', fontWeight: 600 },
  muted: { margin: 0, fontSize: '12px', color: 'var(--color-muted-foreground)' },
  error: { margin: 0, fontSize: '12px', color: 'var(--color-destructive)' },
  button: {
    font: 'inherit', fontSize: '12px', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer',
    border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-foreground)',
    flex: '0 0 auto', whiteSpace: 'nowrap',
  },
  link: {
    font: 'inherit', fontSize: '12px', padding: 0, marginTop: '6px', border: 0, background: 'none',
    color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline',
  },
};

export function makeWidget(React, api, { now = () => new Date(), onGreet = null } = {}) {
  const { createElement: h, useCallback, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function BirthdayWidget() {
    const [state, setState] = useState({ status: 'loading', birthdays: [], error: '' });
    const [expanded, setExpanded] = useState(false);

    const load = useCallback(async () => {
      try {
        const cards = await api.contacts.list();
        setState({ status: 'ready', birthdays: birthdaysFromContacts(cards), error: '' });
      } catch (err) {
        api.log.warn('could not load contacts', err);
        setState((prev) => ({ ...prev, status: 'error', error: errorText(err, api.i18n) }));
      }
    }, []);

    useEffect(() => {
      void load();
      const timer = setInterval(() => { void load(); }, REFRESH_MS);
      const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      };
    }, [load]);

    const { widgetDays } = readSettings(api.plugin.settings);
    const headingId = 'birthdays-heading';
    const children = [h('h2', { key: 'h', id: headingId, style: styles.heading }, t('widget.title'))];

    if (state.status === 'loading') {
      children.push(h('p', { key: 'l', style: styles.muted, role: 'status' }, t('widget.loading')));
    } else if (state.status === 'error') {
      children.push(
        h('p', { key: 'e', style: styles.error, role: 'alert' }, state.error),
        h('button', { key: 'r', type: 'button', style: styles.link, onClick: () => { void load(); } }, t('widget.retry')),
      );
    } else {
      const items = upcomingBirthdays(state.birthdays, localToday(now()), widgetDays);
      if (items.length === 0) {
        children.push(h('p', { key: 'n', style: styles.muted }, t('widget.empty', { days: widgetDays })));
      } else {
        const shown = expanded ? items : items.slice(0, COLLAPSED_ROWS);
        children.push(h('ul', { key: 'u', style: styles.list, 'aria-labelledby': headingId }, shown.map((item) => h(
          'li',
          { key: item.key, style: styles.row, 'data-birthday': item.key },
          h('div', { style: styles.text },
            h('div', { style: styles.name, title: item.name }, item.name),
            h('div', { style: item.daysUntil === 0 ? { ...styles.when, ...styles.today } : styles.when }, whenLine(item, api.i18n)),
          ),
          onGreet && item.email ? h('button', {
            type: 'button',
            style: styles.button,
            'aria-label': t('greet.label', { name: item.name }),
            title: t('greet.label', { name: item.name }),
            onClick: () => { void onGreet(item); },
          }, t('greet.button')) : null,
        ))));
        if (items.length > COLLAPSED_ROWS) {
          children.push(h('button', {
            key: 'm',
            type: 'button',
            style: styles.link,
            'aria-expanded': expanded,
            onClick: () => setExpanded((v) => !v),
          }, expanded ? t('widget.showFewer') : t('widget.showAll', { count: items.length })));
        }
      }
    }
    return h('section', { style: styles.root, 'aria-labelledby': headingId }, children);
  };
}
