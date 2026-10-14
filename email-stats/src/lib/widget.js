// The sidebar section with the counters. The host draws the section header
// (the plugin's name, folding) like Folders and Tags; this draws only the
// rows, as sidebar rows with the count where a folder shows its unread count.
// Built from a factory so tests can hand in React and a fake api.

import { SidebarEmpty, SidebarRow } from '@plugin-host/ui';

export const POLL_MS = 3000;

export const ROWS = [
  { key: 'opened', label: 'Opened', icon: 'mail-opened' },
  { key: 'sent', label: 'Sent', icon: 'send' },
  { key: 'received', label: 'Received', icon: 'inbox' },
];

export function readStats(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    opened: Number(s.opened) || 0,
    sent: Number(s.sent) || 0,
    received: Number(s.received) || 0,
  };
}

export function makeStatsWidget(React, api) {
  const { createElement: h, useCallback, useEffect, useState } = React;

  return function StatsWidget() {
    const [stats, setStats] = useState(null);

    const refresh = useCallback(async () => {
      try {
        setStats(readStats(await api.storage.get('lifetime')));
      } catch (err) {
        api.log.warn('email-stats: could not read storage', err);
        setStats((prev) => prev ?? readStats(null));
      }
    }, []);

    useEffect(() => {
      void refresh();
      const id = setInterval(() => { void refresh(); }, POLL_MS);
      const onFocus = () => { void refresh(); };
      window.addEventListener('focus', onFocus);
      return () => {
        clearInterval(id);
        window.removeEventListener('focus', onFocus);
      };
    }, [refresh]);

    if (!stats) return h(SidebarEmpty, null, 'Loading…');
    return h(React.Fragment, null, ...ROWS.map((row) => h(SidebarRow, {
      key: row.key,
      icon: row.icon,
      label: row.label,
      detail: stats[row.key].toLocaleString(),
    })));
  };
}
