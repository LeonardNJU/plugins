// In the reader: what the sender's clock said when they wrote the message,
// from the offset in its Date header. A one-line info bar above the message
// (with the reader's own info bars), and a row in the message details where
// the sender's time zone can be set.

import { useState } from 'react';
import { DetailList, DetailRow, InfoBar, LinkButton, Row, Stack, Text } from '@plugin-host/ui';
import { t, locale } from '../host.js';
import { senderTime, worthShowing } from '../lib/sender.js';
import { zoneCity } from '../lib/zones.js';
import { ZoneField, useAddressZones, useSettings } from './common.jsx';

function useSenderInfo(email) {
  const settings = useSettings();
  const { zones, loaded, save } = useAddressZones();
  const info = senderTime(email, { home: settings.home, addressZones: zones, locale: locale() });
  return { info, settings, loaded, save };
}

function nowThere(info) {
  return info.nowThere ? t('reader.nowThere', { time: info.nowThere, city: zoneCity(info.savedZone) }) : '';
}

/** email-banner: "Sent at 11:40 PM their time (UTC−5), 6:40 AM your time", then "now 10:00 AM in Chicago" once a zone is saved. */
export function SenderBanner({ email }) {
  const { info, settings, loaded } = useSenderInfo(email);
  if (!loaded || !worthShowing(info, settings.home)) return null;
  const there = nowThere(info);
  return (
    // The time there now is a second, muted part: on a narrow reader it
    // wraps below the line rather than pushing the line under the icon.
    <InfoBar compact icon="clock" title={t('reader.banner', { time: info.sent, offset: info.offset, yours: info.yours })}>
      {there && <Text tone="muted">{there}</Text>}
    </InfoBar>
  );
}

/** email-details-section, under "Recipients & routing" (next to Sent). */
export function SenderDetails({ email }) {
  const { info, loaded, save } = useSenderInfo(email);
  const [editing, setEditing] = useState(false);
  if (!loaded || !info) return null;
  const there = nowThere(info);
  return (
    // The details' label and value columns, so the row lines up with Sent
    // and Received above it.
    <DetailList>
      <DetailRow label={t('reader.label')}>
      <Stack gap={2}>
        <Row gap={2} align="baseline">
          <Text>{`${info.sent} (${info.offset})${there ? ` · ${there}` : ''}`}</Text>
          {info.address && !editing && (
            <LinkButton onClick={() => setEditing(true)}>
              {t(info.savedZone ? 'reader.change' : 'reader.setFor')}
            </LinkButton>
          )}
        </Row>
        {editing && (
          <ZoneField
            label={t('zone.labelFor', { address: info.address })}
            onCancel={() => setEditing(false)}
            onSubmit={async (zone) => { await save(info.address, zone); setEditing(false); }}
          />
        )}
      </Stack>
      </DetailRow>
    </DetailList>
  );
}
