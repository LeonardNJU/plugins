// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { ADDRESS_ZONES_REFRESH_MS } from '../src/ui/common.jsx';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { findDateHeader, parseDateHeader, senderClock } from '../src/lib/date-header.js';
import { senderTime, worthShowing } from '../src/lib/sender.js';
import { setApi } from '../src/host.js';
import { SenderBanner, SenderDetails } from '../src/ui/sender-time.jsx';
import plugin from '../src/index.js';
import manifest from '../manifest.json' with { type: 'json' };
import { button, click, mount, settle, type } from './dom.mjs';

describe('parseDateHeader', () => {
  it('reads the instant and the offset', () => {
    expect(parseDateHeader('Tue, 14 Oct 2026 23:40:00 -0500')).toEqual({ instant: Date.parse('2026-10-15T04:40:00Z'), offsetMinutes: -300 });
    expect(parseDateHeader('14 Oct 2026 09:05 +0530')).toEqual({ instant: Date.parse('2026-10-14T03:35:00Z'), offsetMinutes: 330 });
  });
  it('copes with folding, comments and odd spacing', () => {
    expect(parseDateHeader(' Wed,\r\n 14 Oct 2026  15:00:00 +0200 (CEST)')).toEqual({ instant: Date.parse('2026-10-14T13:00:00Z'), offsetMinutes: 120 });
  });
  it('knows the old US zone names and two-digit years', () => {
    expect(parseDateHeader('Mon, 5 Jan 26 08:00:00 EST')).toEqual({ instant: Date.parse('2026-01-05T13:00:00Z'), offsetMinutes: -300 });
    expect(parseDateHeader('5 Jan 99 08:00 GMT').instant).toBe(Date.parse('1999-01-05T08:00:00Z'));
  });
  it('treats -0000 and unknown names as an unknown zone', () => {
    expect(parseDateHeader('14 Oct 2026 10:00:00 -0000').offsetMinutes).toBeNull();
    expect(parseDateHeader('14 Oct 2026 10:00:00 XYZ').offsetMinutes).toBeNull();
    expect(senderClock(parseDateHeader('14 Oct 2026 10:00:00 -0000'))).toBeNull();
  });
  it('refuses garbage', () => {
    expect(parseDateHeader('yesterday')).toBeNull();
    expect(parseDateHeader('32 Oct 2026 10:00 +0000')).toBeNull();
    expect(parseDateHeader('14 Foo 2026 10:00 +0000')).toBeNull();
    expect(parseDateHeader('14 Oct 2026 10:00 +9900')).toBeNull();
    expect(parseDateHeader(undefined)).toBeNull();
  });
  it('finds the header whatever its case', () => {
    expect(findDateHeader({ DATE: 'x' })).toBe('x');
    expect(findDateHeader({ date: ['a', 'b'] })).toBe('a');
    expect(findDateHeader({ Subject: 'x' })).toBeNull();
    expect(findDateHeader(undefined)).toBeNull();
  });
});

const mail = (date, from = 'bob@example.org') => ({ id: 'm1', from: [{ name: 'Bob', email: from }], headers: { Date: date } });

describe('senderTime', () => {
  it('gives the sender\'s clock and offset', () => {
    const info = senderTime(mail('Wed, 14 Oct 2026 23:40:00 -0500'), { home: 'Europe/Berlin', locale: 'de' });
    expect(info).toMatchObject({ sent: '23:40', yours: '06:40', offset: 'UTC−5', sameAsYours: false, savedZone: null, nowThere: null });
    expect(worthShowing(info, 'Europe/Berlin')).toBe(true);
  });
  it('is not worth a line when the sender was on your clock', () => {
    const info = senderTime(mail('Wed, 14 Oct 2026 15:00:00 +0200'), { home: 'Europe/Berlin', locale: 'de' });
    expect(info.sameAsYours).toBe(true);
    expect(worthShowing(info, 'Europe/Berlin')).toBe(false);
  });
  it('adds the time now in a zone saved for the sender', () => {
    const info = senderTime(mail('Wed, 14 Oct 2026 15:00:00 +0200', 'Bob@Example.org'), {
      home: 'Europe/Berlin', locale: 'de', addressZones: { 'bob@example.org': 'America/Chicago' }, now: Date.parse('2026-10-14T15:00:00Z'),
    });
    expect(info.nowThere).toBe('10:00');
    expect(worthShowing(info, 'Europe/Berlin')).toBe(true);
  });
  it('is null without a usable Date header', () => {
    expect(senderTime({ headers: {} }, { home: 'UTC' })).toBeNull();
    expect(senderTime(mail('14 Oct 2026 10:00 -0000'), { home: 'UTC' })).toBeNull();
    expect(senderTime(null, {})).toBeNull();
  });
});

describe('reader slots', () => {
  afterEach(() => setApi(null));
  const setup = async (zones = {}) => {
    const api = fakeApi({ settings: { homeZone: 'Europe/Berlin' }, translations: manifest.locales, locale: 'en-GB' });
    await api.storage.set('addressZones', zones);
    setApi(api);
    return api;
  };

  it('offers the banner only when the sender\'s clock differs from yours', async () => {
    await setup();
    expect(plugin.slots['reader-below-subject']).toBeUndefined();
    expect(plugin.slots['email-banner'].component).toBe(SenderBanner);
    const { shouldShow } = plugin.slots['email-banner'];
    expect(shouldShow({ email: mail('Wed, 14 Oct 2026 23:40:00 -0500') })).toBe(true);
    expect(shouldShow({ email: mail('Wed, 14 Oct 2026 15:00:00 +0200') })).toBe(false);
    expect(shouldShow({ email: { headers: {} } })).toBe(false);
  });

  it('offers the details row under recipients and routing only', async () => {
    await setup();
    const { shouldShow } = plugin.slots['email-details-section'];
    const email = mail('Wed, 14 Oct 2026 15:00:00 +0200');
    expect(shouldShow({ email, category: 'recipients_routing' })).toBe(true);
    expect(shouldShow({ email, category: null })).toBe(false);
    expect(shouldShow({ email: { headers: {} }, category: 'recipients_routing' })).toBe(false);
  });

  it('says in one info bar line when the sender wrote, on their clock and on yours', async () => {
    await setup();
    const ui = await mount(SenderBanner, { email: mail('Wed, 14 Oct 2026 23:40:00 -0500') });
    expect(ui.$('.bk-infobar').textContent).toBe('Sent at 23:40 their time (UTC−5), 06:40 your time');
    await ui.unmount();
  });

  it('adds the time there now once a zone is saved for the sender', async () => {
    await setup({ 'bob@example.org': 'America/Chicago' });
    const ui = await mount(SenderBanner, { email: mail('Wed, 14 Oct 2026 15:00:00 +0200') });
    const [line, there] = ui.$('.bk-infobar').children;
    expect(line.textContent).toBe('Sent at 15:00 their time (UTC+2), 15:00 your time');
    expect(there.textContent).toMatch(/^now \d\d:\d\d in Chicago$/);
    await ui.unmount();
  });

  it('picks up a zone saved for the sender in another frame (the details)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const api = await setup();
      const ui = await mount(SenderBanner, { email: mail('Wed, 14 Oct 2026 23:40:00 -0500') });
      expect(ui.text()).not.toContain('Chicago');
      await api.storage.set('addressZones', { 'bob@example.org': 'America/Chicago' });
      await act(async () => { vi.advanceTimersByTime(ADDRESS_ZONES_REFRESH_MS); });
      await settle();
      expect(ui.text()).toMatch(/your timenow \d\d:\d\d in Chicago$/);
      await ui.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no bar when there is nothing to tell', async () => {
    await setup();
    const ui = await mount(SenderBanner, { email: mail('Wed, 14 Oct 2026 15:00:00 +0200') });
    expect(ui.container.innerHTML).toBe('');
    await ui.unmount();
  });

  it('sets the sender\'s zone from the details and then shows the time there', async () => {
    const api = await setup();
    const ui = await mount(SenderDetails, { email: mail('Wed, 14 Oct 2026 23:40:00 -0500') });
    expect(ui.text()).toContain('Their time');
    expect(ui.text()).toContain('23:40 (UTC−5)');
    await click(button(ui.container, 'Set time zone'));
    await type(ui.$('input'), 'Chicago');
    await click(button(ui.container, 'Save'));
    expect(api.storageSnapshot().addressZones).toEqual({ 'bob@example.org': 'America/Chicago' });
    expect(ui.text()).toMatch(/now \d\d:\d\d in Chicago/);
    expect(button(ui.container, 'Change time zone')).toBeTruthy();
    await ui.unmount();
  });
});
