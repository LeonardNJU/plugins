// The sidebar section: upcoming birthdays from the user's contacts. The host
// draws the section header (chevron, title, folding) like Folders and Tags;
// this draws only the rows, with the kit's sidebar rows. Built from a
// factory so tests can hand in React and a fake api; src/index.js passes the
// real ones.

import { SidebarEmpty, SidebarRow } from '@plugin-host/ui';
import { birthdaysFromContacts, upcomingBirthdays } from './contacts.js';
import { localToday } from './dates.js';
import { errorText, shortWhen, whenLine } from './format.js';
import { readSettings } from './settings.js';

/** Rows shown before "Show all". */
export const COLLAPSED_ROWS = 5;
/** How often an open section reloads the contacts. */
export const REFRESH_MS = 10 * 60 * 1000;

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

    if (state.status === 'loading') {
      return h('div', { role: 'status' }, h(SidebarEmpty, null, t('widget.loading')));
    }
    if (state.status === 'error') {
      return h('div', null,
        h('div', { role: 'alert' }, h(SidebarEmpty, null, state.error)),
        h(SidebarRow, { icon: 'refresh', label: t('widget.retry'), onClick: () => { void load(); } }));
    }

    const { widgetDays } = readSettings(api.plugin.settings);
    const items = upcomingBirthdays(state.birthdays, localToday(now()), widgetDays);
    if (items.length === 0) return h(SidebarEmpty, null, t('widget.empty', { days: widgetDays }));

    const shown = expanded ? items : items.slice(0, COLLAPSED_ROWS);
    return h('div', null,
      h('div', { role: 'list', 'aria-label': t('widget.title') }, shown.map((item) => {
        const greet = onGreet && item.email ? () => { void onGreet(item); } : undefined;
        // The full line ("Today · October 14 · turns 36") and what a click
        // does go in the tooltip; the row itself stays as short as a folder's.
        const title = [`${item.name}: ${whenLine(item, api.i18n)}`, greet ? t('greet.label', { name: item.name }) : null]
          .filter(Boolean).join('\n');
        return h('div', { key: item.key, role: 'listitem', 'data-birthday': item.key },
          h(SidebarRow, {
            icon: 'cake', label: item.name, detail: shortWhen(item, api.i18n), title, onClick: greet,
            // Screen readers hear what the click does, not only the name.
            ...(greet ? { ariaLabel: `${t('greet.label', { name: item.name })} (${whenLine(item, api.i18n)})` } : {}),
          }));
      })),
      items.length > COLLAPSED_ROWS
        ? h(SidebarRow, {
          icon: 'dots',
          label: expanded ? t('widget.showFewer') : t('widget.showAll', { count: items.length }),
          onClick: () => setExpanded((v) => !v),
        })
        : null);
  };
}
