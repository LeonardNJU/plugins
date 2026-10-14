// On the plugin's page in Settings: how the favourites the user typed were
// understood, and the zones set for people (with a way to add and remove).

import { useState } from 'react';
import { Alert, Button, Field, Input, List, ListRow, Row, RowAction, Section, Stack, Text } from '@plugin-host/ui';
import { t, locale } from '../host.js';
import { normaliseAddress } from '../lib/address-zones.js';
import { formatOffset, formatTime, offsetMinutes, zoneCity } from '../lib/zones.js';
import { ZoneField, useAddressZones, useSettings } from './common.jsx';

function ZoneRow({ zone, now }) {
  return (
    <ListRow
      title={zoneCity(zone)}
      subtitle={`${zone} · ${formatOffset(offsetMinutes(zone, now))}`}
      meta={[formatTime(now, zone, locale())]}
    />
  );
}

export function SettingsSection() {
  const settings = useSettings();
  const { zones, save } = useAddressZones();
  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState('');
  const [adding, setAdding] = useState(false);
  const now = Date.now();
  const people = Object.entries(zones);

  return (
    <Stack gap={6}>
      <Section title={t('settings.yourZone')}>
        <List label={t('settings.yourZone')}>
          <ZoneRow zone={settings.home} now={now} />
        </List>
        {settings.homeUnknown && (
          <Alert tone="warning" icon="alert-triangle">{t('settings.homeUnknown', { entry: settings.homeUnknown })}</Alert>
        )}
      </Section>

      <Section title={t('settings.favourites')}>
        {settings.favourites.length === 0 ? (
          <Text tone="muted">{t('settings.noFavourites')}</Text>
        ) : (
          <List label={t('settings.favourites')}>
            {settings.favourites.map((z) => <ZoneRow key={z} zone={z} now={now} />)}
          </List>
        )}
        {settings.unknown.length > 0 && (
          <Alert tone="warning" icon="alert-triangle">{t('settings.unknown', { entries: settings.unknown.join(', ') })}</Alert>
        )}
      </Section>

      <Section title={t('settings.people')}>
        {people.length === 0 ? (
          <Text tone="muted">{t('settings.noPeople')}</Text>
        ) : (
          <List label={t('settings.people')}>
            {people.map(([a, z]) => (
              <ListRow
                key={a}
                title={a}
                subtitle={`${zoneCity(z)} · ${formatOffset(offsetMinutes(z, now))}`}
                actions={<RowAction icon="trash" label={`${t('remove')}: ${a}`} onClick={() => void save(a, null)} />}
              />
            ))}
          </List>
        )}
        {!adding ? (
          <Row>
            <Button variant="secondary" icon="plus" onClick={() => setAdding(true)}>{t('settings.addPerson')}</Button>
          </Row>
        ) : (
          <Stack gap={4}>
            <Field label={t('settings.address')} error={addressError || undefined}>
              <Input
                type="email"
                value={address}
                autoFocus
                onChange={(e) => { setAddress(e.target.value); setAddressError(''); }}
              />
            </Field>
            <ZoneField
              autoFocus={false}
              label={t('zone.label')}
              onCancel={() => { setAdding(false); setAddress(''); setAddressError(''); }}
              onSubmit={async (zone) => {
                const a = normaliseAddress(address);
                if (!a) { setAddressError(t('settings.invalidAddress')); return; }
                await save(a, zone);
                setAdding(false);
                setAddress('');
              }}
            />
          </Stack>
        )}
      </Section>
    </Stack>
  );
}
