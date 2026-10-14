// The agenda, drawn with the app's UI kit for the place the user picked:
//   - sidebar-section: one sidebar row per event. The host draws the section
//     header (the title set with api.ui.setSectionTitle) and folds it.
//   - email-detail-sidebar: a heading and a list of rows, like the Files app.
//   - app-top-banner: a one-line info bar with the next events as chips.
// Built from a factory so tests can hand in React and a fake api.

import {
  Alert, Chip, EmptyState, Heading, Icon, InfoBar, List, ListRow, Loading, Page,
  SidebarEmpty, SidebarRow, Stack, Text,
} from '@plugin-host/ui';

export const DIRTY_KEY = 'agendaDirty'; // timestamp bumped by calendar hooks
export const AGENDA_PATH = '/api/calendar-agenda';
/** Chips shown in the top banner. */
export const BANNER_EVENTS = 4;

export const POSITION_TO_SLOT = {
  'Left sidebar': 'sidebar-section',
  'Email reading pane': 'email-detail-sidebar',
  'Top banner': 'app-top-banner',
};
export const DEFAULT_SLOT = 'sidebar-section';

export function slotForPosition(position) {
  return POSITION_TO_SLOT[position] || DEFAULT_SLOT;
}

function startOfDay(d) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

export function makeFormat(api, now = () => new Date()) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const locale = () => api.i18n.locale || (api.i18n.getLocale && api.i18n.getLocale()) || undefined;

  function dayLabel(date) {
    const diffDays = Math.round((startOfDay(date).getTime() - startOfDay(now()).getTime()) / 86_400_000);
    if (diffDays === 0) return t('day.today');
    if (diffDays === 1) return t('day.tomorrow');
    return date.toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function timeLabel(ev) {
    if (ev.allDay) return t('event.all_day');
    return new Date(ev.start).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  }

  /** "14:00" today, "Tomorrow 09:30", "Wed, Oct 16" for an all-day event. */
  function when(ev) {
    const start = new Date(ev.start);
    const today = Math.round((startOfDay(start).getTime() - startOfDay(now()).getTime()) / 86_400_000) === 0;
    if (today) return timeLabel(ev);
    return ev.allDay ? dayLabel(start) : `${dayLabel(start)} ${timeLabel(ev)}`;
  }

  return { t, dayLabel, timeLabel, when };
}

export function makeAgenda(React, api, { slot = DEFAULT_SLOT, now } = {}) {
  const { createElement: h, useCallback, useEffect, useRef, useState } = React;
  const fmt = makeFormat(api, now);
  const { t } = fmt;

  // A cancelled event keeps its row, struck through.
  const titleOf = (ev) => (ev.status === 'cancelled' ? h('del', null, ev.title) : ev.title);
  const tooltip = (ev) => [ev.title, fmt.when(ev), ev.location].filter(Boolean).join(' · ');

  function useAgenda() {
    const [events, setEvents] = useState([]);
    const [state, setState] = useState('loading'); // loading | ready | error | unauth
    const [error, setError] = useState('');
    const lastDirtyRef = useRef(null);
    const inFlightRef = useRef(false);

    const settings = api.plugin?.settings || {};
    const days = Number(settings.daysAhead) || 7;
    const limit = Number(settings.maxEvents) || 50;
    const refreshMs = Math.max(1, Number(settings.refreshMinutes) || 10) * 60_000;

    const fetchAgenda = useCallback(async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await api.http.post(AGENDA_PATH, { days, limit });
        if (res?.status === 401) {
          setState('unauth');
          return;
        }
        if (!res?.ok) {
          setError((res?.data && res.data.error) || `HTTP ${res?.status || '??'}`);
          setState('error');
          return;
        }
        setEvents(Array.isArray(res.data?.events) ? res.data.events : []);
        setState('ready');
      } catch (err) {
        api.log.warn('calendar-agenda: fetch failed', err);
        setError(String((err && err.message) || err));
        setState('error');
      } finally {
        inFlightRef.current = false;
      }
    }, [days, limit]);

    useEffect(() => {
      void fetchAgenda();
      const pollId = setInterval(() => { void fetchAgenda(); }, refreshMs);
      // Refetch when calendar data changes (background hooks bump the
      // marker) or when the iframe regains focus.
      const dirtyId = setInterval(async () => {
        try {
          const mark = await api.storage.get(DIRTY_KEY);
          if (mark && mark !== lastDirtyRef.current) {
            lastDirtyRef.current = mark;
            void fetchAgenda();
          }
        } catch { /* ignore */ }
      }, 4000);
      const onFocus = () => { void fetchAgenda(); };
      window.addEventListener('focus', onFocus);
      return () => {
        clearInterval(pollId);
        clearInterval(dirtyId);
        window.removeEventListener('focus', onFocus);
      };
    }, [fetchAgenda, refreshMs]);

    let message = null;
    if (state === 'loading') message = t('state.loading');
    else if (state === 'unauth') message = t('state.unauth');
    else if (state === 'error') message = t('state.error', { error });
    else if (events.length === 0) message = t('state.empty', { days });
    return { events, state, message };
  }

  function SidebarAgenda() {
    const { events, message } = useAgenda();
    if (message) return h(SidebarEmpty, null, message);
    return h(React.Fragment, null, ...events.map((ev) => h(SidebarRow, {
      key: ev.id,
      icon: 'calendar-event',
      label: titleOf(ev),
      detail: fmt.when(ev),
      title: tooltip(ev),
    })));
  }

  function PanelAgenda() {
    const { events, state, message } = useAgenda();
    let body;
    if (state === 'loading') body = h(Loading, { label: message });
    else if (state === 'error') body = h(Alert, { tone: 'danger', icon: 'alert-triangle' }, message);
    else if (message) body = h(EmptyState, { compact: true, icon: 'calendar', title: message });
    else {
      body = h(List, { label: t('header.title') }, ...events.map((ev) => h(ListRow, {
        key: ev.id,
        icon: h(Icon, { name: 'calendar-event' }),
        title: titleOf(ev),
        subtitle: [fmt.when(ev), ev.location].filter(Boolean).join(' · '),
      })));
    }
    return h(Page, null, h(Stack, { gap: 3 }, h(Heading, { level: 3 }, t('header.title')), body));
  }

  function BannerAgenda() {
    const { events, message } = useAgenda();
    return h(InfoBar, { compact: true, tone: 'primary', icon: 'calendar', eyebrow: t('header.title'), title: message || undefined },
      ...(message ? [] : events.slice(0, BANNER_EVENTS).map((ev) => h(Chip, {
        key: ev.id, icon: 'calendar-event', label: ev.title, detail: fmt.when(ev), title: tooltip(ev),
      }))),
      !message && events.length > BANNER_EVENTS ? h(Text, { key: 'more', size: 'xs', tone: 'muted' }, `+${events.length - BANNER_EVENTS}`) : null);
  }

  if (slot === 'email-detail-sidebar') return PanelAgenda;
  if (slot === 'app-top-banner') return BannerAgenda;
  return SidebarAgenda;
}
