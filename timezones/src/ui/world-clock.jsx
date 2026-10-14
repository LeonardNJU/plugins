// The optional world clock in the mail sidebar: the time now in your zone
// and in each favourite zone, dimmed outside working hours.

import { useEffect, useState } from 'react';
import { t, locale } from '../host.js';
import { dayShift, formatOffset, formatTime, isOutsideHours, offsetMinutes, zoneCity } from '../lib/zones.js';
import { Styles, useSettings } from './common.jsx';

/** The current time, updated every `ms`. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** sidebar-section */
export function WorldClock() {
  const settings = useSettings();
  const now = useNow();
  const loc = locale();
  const zones = [settings.home, ...settings.favourites];
  return (
    <div data-tz="clock" style={{ padding: '2px 12px 8px', fontSize: 13 }} aria-label={t('clock.heading')}>
      <Styles />
      {settings.favourites.length === 0 && <div className="tz-muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('clock.empty')}</div>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {zones.map((zone) => {
          const shift = dayShift(now, zone, settings.home);
          const off = isOutsideHours(now, now, zone, settings.workStart, settings.workEnd);
          return (
            <li key={zone} data-zone={zone} data-outside={off ? 'true' : 'false'}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, opacity: off ? 0.6 : 1 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {zoneCity(zone)} <span className="tz-muted" style={{ fontSize: 11 }}>{formatOffset(offsetMinutes(zone, now))}</span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {formatTime(now, zone, loc)}
                {shift !== 0 && <span className="tz-muted" data-tz="day" style={{ fontSize: 11 }}> {shift > 0 ? '+1' : '−1'}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
