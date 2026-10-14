// In the event form: the event's time for each participant with a known
// time zone and in the favourite zones, marked when it falls outside working
// hours, and a way to set a missing zone. The warning itself is the form's
// own (onCheckEventConflicts in index.js), so it isn't repeated here.

import { useState } from 'react';
import { Badge, LinkButton, List, ListRow, Row, Stack, Text } from '@plugin-host/ui';
import { t, locale } from '../host.js';
import { eventZones } from '../lib/event.js';
import { formatOffset, formatTime, offsetMinutes, zoneCity } from '../lib/zones.js';
import { ZoneField, useAddressZones, useSettings } from './common.jsx';

function range(row, loc) {
  const from = formatTime(row.start, row.zone, loc);
  if (row.end <= row.start) return from;
  return `${from}–${formatTime(row.end, row.zone, loc)}`;
}

/** "22:00–23:00 (next day) · UTC+9", plus "· favourite" for a favourite zone without participants. */
function detail(row, loc) {
  const parts = [range(row, loc) + (row.dayShift !== 0 ? ` (${t(row.dayShift > 0 ? 'event.nextDay' : 'event.prevDay')})` : '')];
  parts.push(formatOffset(offsetMinutes(row.zone, row.start)));
  if (row.emails.length === 0) parts.push(t('event.favourite'));
  return parts.join(' · ');
}

/** "Tokyo · kei@example.jp" */
function title(row) {
  return [zoneCity(row.zone), ...row.emails].join(' · ');
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
    <Stack gap={2}>
      <Text weight="medium">{t('event.heading')}</Text>
      {info.rows.length > 0 && (
        <List label={t('event.heading')}>
          {info.rows.map((row) => (
            <ListRow
              key={row.zone}
              title={title(row)}
              subtitle={detail(row, loc)}
              actions={row.outside ? <Badge tone="warning">{t('event.outside')}</Badge> : undefined}
            />
          ))}
        </List>
      )}
      {info.missing.map((address) => (
        editing === address ? (
          <ZoneField
            key={address}
            label={t('zone.labelFor', { address })}
            onCancel={() => setEditing(null)}
            onSubmit={async (zone) => { await save(address, zone); setEditing(null); }}
          />
        ) : (
          <Row key={address} gap={2}>
            <Text tone="muted">{t('event.missing', { address })}</Text>
            <LinkButton onClick={() => setEditing(address)} aria-label={t('zone.labelFor', { address })}>
              {t('event.set')}
            </LinkButton>
          </Row>
        )
      ))}
    </Stack>
  );
}
