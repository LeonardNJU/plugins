// The optional world clock in the mail sidebar: the time now in your zone
// and in each favourite zone: a sun in working hours, a moon outside them.

import { useEffect, useState } from 'react';
import { SidebarEmpty, SidebarRow } from '@plugin-host/ui';
import { t, locale } from '../host.js';
import { dayShift, formatOffset, formatTime, isOutsideHours, offsetMinutes, zoneCity } from '../lib/zones.js';
import { useSettings } from './common.jsx';

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
    <>
      {zones.map((zone) => {
        const shift = dayShift(now, zone, settings.home);
        const off = isOutsideHours(now, now, zone, settings.workStart, settings.workEnd);
        const city = zoneCity(zone);
        const title = [city, formatOffset(offsetMinutes(zone, now)), ...(off ? [t('event.outside')] : [])].join(' · ');
        return (
          <SidebarRow
            key={zone}
            icon={off ? 'moon' : 'sun'}
            label={city}
            detail={`${formatTime(now, zone, loc)}${shift !== 0 ? (shift > 0 ? ' +1' : ' −1') : ''}`}
            title={title}
          />
        );
      })}
      {settings.favourites.length === 0 && <SidebarEmpty>{t('clock.empty')}</SidebarEmpty>}
    </>
  );
}
