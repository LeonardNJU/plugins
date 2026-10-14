// In the event form: the event's time for each participant with a known
// time zone and in the favourite zones, marked when it falls outside working
// hours, and a way to set a missing zone. The warning itself comes from the
// onCheckEventConflicts hook, so the form shows it with its own warnings.

import { useState } from 'react';
import { t, locale } from '../host.js';
import { eventZones } from '../lib/event.js';
import { formatOffset, formatTime, offsetMinutes, zoneCity } from '../lib/zones.js';
import { ClockIcon, Styles, ZoneField, useAddressZones, useSettings } from './common.jsx';

function range(row, loc) {
  const from = formatTime(row.start, row.zone, loc);
  if (row.end <= row.start) return from;
  return `${from}–${formatTime(row.end, row.zone, loc)}`;
}

export function EventZones(props) {
  const eventData = props?.event ?? props?.eventData ?? null;
  const settings = useSettings();
  const { zones, loaded, save } = useAddressZones();
  const [editing, setEditing] = useState(null);
  if (!loaded) return null;
  const info = eventZones(eventData, settings, zones);
  if (!info || info.allDay) return null;
  if (info.rows.length === 0 && info.missing.length === 0) return null;
  const loc = locale();

  return (
    <div data-tz="event" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0', fontSize: 13 }}>
      <Styles />
      <div className="tz-row tz-muted" style={{ gap: 6, alignItems: 'center' }}>
        <ClockIcon />
        <span style={{ fontWeight: 600 }}>{t('event.heading')}</span>
      </div>
      {info.rows.length > 0 && (
        <ul data-tz="rows" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {info.rows.map((row) => (
            <li key={row.zone} className="tz-row" style={{ gap: 6 }} data-zone={row.zone}>
              <strong style={{ fontWeight: 600 }}>{zoneCity(row.zone)}</strong>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{range(row, loc)}</span>
              <span className="tz-muted">{formatOffset(offsetMinutes(row.zone, row.start))}</span>
              {row.dayShift !== 0 && <span className="tz-muted">({t(row.dayShift > 0 ? 'event.nextDay' : 'event.prevDay')})</span>}
              {row.emails.length > 0
                ? <span className="tz-muted" style={{ overflowWrap: 'anywhere' }}>{row.emails.join(', ')}</span>
                : <span className="tz-muted">· {t('event.favourite')}</span>}
              {row.outside && <span className="tz-warn">· {t('event.outside')}</span>}
            </li>
          ))}
        </ul>
      )}
      {info.missing.map((address) => (
        <div key={address} data-tz="missing">
          {editing === address ? (
            <ZoneField
              label={t('zone.labelFor', { address })}
              onCancel={() => setEditing(null)}
              onSubmit={async (zone) => { await save(address, zone); setEditing(null); }}
            />
          ) : (
            <div className="tz-row" style={{ gap: 6 }}>
              <span className="tz-muted" style={{ overflowWrap: 'anywhere' }}>{t('event.missing', { address })}</span>
              <button type="button" className="tz-link" onClick={() => setEditing(address)} aria-label={t('zone.labelFor', { address })}>
                {t('event.set')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
