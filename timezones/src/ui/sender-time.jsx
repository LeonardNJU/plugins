// In the reader: what the sender's clock said when they wrote the message,
// from the offset in its Date header. A line under the subject, and a row in
// the message details where the sender's time zone can be set.

import { useState } from 'react';
import { t, locale } from '../host.js';
import { senderTime, worthShowing } from '../lib/sender.js';
import { zoneCity } from '../lib/zones.js';
import { ClockIcon, Styles, ZoneField, useAddressZones, useSettings } from './common.jsx';

function useSenderInfo(email) {
  const settings = useSettings();
  const { zones, loaded, save } = useAddressZones();
  const info = senderTime(email, { home: settings.home, addressZones: zones, locale: locale() });
  return { info, settings, loaded, save };
}

function NowThere({ info }) {
  if (!info.nowThere) return null;
  return <span className="tz-muted"> · {t('reader.nowThere', { time: info.nowThere, city: zoneCity(info.savedZone) })}</span>;
}

/** reader-below-subject */
export function SenderLine({ email }) {
  const { info, settings, loaded } = useSenderInfo(email);
  if (!loaded || !worthShowing(info, settings.home)) return null;
  return (
    <div data-tz="sender-line" className="tz-muted tz-line" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <Styles />
      {/* Lines up with the message header, which is wider-padded on big screens. */}
      <style>{'.tz-line{padding:2px 16px 6px}@media (min-width:600px){.tz-line{padding:2px 24px 6px}}'}</style>
      <ClockIcon size={13} />
      <span>
        {t('reader.sent', { time: info.sent, offset: info.offset })}
        <NowThere info={info} />
      </span>
    </div>
  );
}

/** email-details-section, under "Recipients & routing" (next to Sent). */
export function SenderDetails({ email }) {
  const { info, loaded, save } = useSenderInfo(email);
  const [editing, setEditing] = useState(false);
  if (!loaded || !info) return null;
  return (
    <div data-tz="sender-details" style={{ display: 'grid', gridTemplateColumns: '7rem 1fr', columnGap: 16, fontSize: 13 }}>
      <Styles />
      <span className="tz-muted">{t('reader.label')}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span>
          {info.sent} ({info.offset})
          <NowThere info={info} />
          {info.address && !editing && (
            <>
              {' '}
              <button type="button" className="tz-link" onClick={() => setEditing(true)}>
                {t(info.savedZone ? 'reader.change' : 'reader.setFor')}
              </button>
            </>
          )}
        </span>
        {editing && (
          <ZoneField
            label={t('zone.labelFor', { address: info.address })}
            onCancel={() => setEditing(false)}
            onSubmit={async (zone) => { await save(info.address, zone); setEditing(false); }}
          />
        )}
      </div>
    </div>
  );
}
