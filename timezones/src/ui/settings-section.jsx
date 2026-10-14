// On the plugin's page in Settings: how the favourites the user typed were
// understood, and the zones set for people (with a way to add and remove).

import { useState } from 'react';
import { t, locale } from '../host.js';
import { normaliseAddress } from '../lib/address-zones.js';
import { formatOffset, formatTime, offsetMinutes, zoneCity } from '../lib/zones.js';
import { Styles, ZoneField, useAddressZones, useSettings } from './common.jsx';

function ZoneLine({ zone, now }) {
  return (
    <span>
      <strong>{zoneCity(zone)}</strong>{' '}
      <span className="tz-muted">{zone} · {formatOffset(offsetMinutes(zone, now))} · {formatTime(now, zone, locale())}</span>
    </span>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }} data-tz="settings">
      <Styles />
      <section aria-labelledby="tz-home">
        <div id="tz-home" className="tz-label">{t('settings.yourZone')}</div>
        <div><ZoneLine zone={settings.home} now={now} /></div>
        {settings.homeUnknown && (
          <div className="tz-warn" role="status">{t('settings.homeUnknown', { entry: settings.homeUnknown })}</div>
        )}
      </section>

      <section aria-labelledby="tz-fav">
        <div id="tz-fav" className="tz-label">{t('settings.favourites')}</div>
        {settings.favourites.length === 0 ? (
          <div className="tz-muted">{t('settings.noFavourites')}</div>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: 18 }} data-tz="favourites">
            {settings.favourites.map((z) => <li key={z}><ZoneLine zone={z} now={now} /></li>)}
          </ul>
        )}
        {settings.unknown.length > 0 && (
          <div className="tz-warn" role="status" data-tz="unknown">{t('settings.unknown', { entries: settings.unknown.join(', ') })}</div>
        )}
      </section>

      <section aria-labelledby="tz-people">
        <div id="tz-people" className="tz-label">{t('settings.people')}</div>
        {people.length === 0 ? (
          <div className="tz-muted">{t('settings.noPeople')}</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }} data-tz="people">
            {people.map(([a, z]) => (
              <li key={a} className="tz-row" style={{ justifyContent: 'space-between' }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{a} <span className="tz-muted">· {zoneCity(z)} ({formatOffset(offsetMinutes(z, now))})</span></span>
                <button type="button" className="tz-btn tz-btn-ghost" onClick={() => void save(a, null)} aria-label={`${t('remove')}: ${a}`}>{t('remove')}</button>
              </li>
            ))}
          </ul>
        )}
        {!adding ? (
          <button type="button" className="tz-btn" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>{t('settings.addPerson')}</button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <label className="tz-muted" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {t('settings.address')}
              <input
                className="tz-input"
                type="email"
                value={address}
                autoFocus
                onChange={(e) => { setAddress(e.target.value); setAddressError(''); }}
              />
            </label>
            {addressError && <div role="alert" className="tz-error">{addressError}</div>}
            <ZoneField
              autoFocus={false}
              label={t('zone.label')}
              onCancel={() => { setAdding(false); setAddress(''); }}
              onSubmit={async (zone) => {
                const a = normaliseAddress(address);
                if (!a) { setAddressError(t('settings.invalidAddress')); return; }
                await save(a, zone);
                setAdding(false);
                setAddress('');
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
