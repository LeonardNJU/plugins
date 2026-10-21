// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { durationMs, makeAgenda, slotForPosition } from '../src/lib/agenda.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'calendar-agenda', 'manifest.json'), 'utf8'));
const NOW = () => new Date(2026, 9, 14, 9, 0);

afterEach(cleanup);

/** A timed event as api.calendar.getEvents returns it, starting at local `start`. */
function timed(id, title, start, minutes, extra = {}) {
  return {
    id, uid: id, calendarId: 'cal', title, description: '',
    // Wall-clock time in the event's own zone, which is not the viewer's.
    start: '2026-01-01T03:00:00', timeZone: 'Pacific/Kiritimati', duration: `PT${minutes}M`,
    utcStart: start.toISOString(), utcEnd: new Date(start.getTime() + minutes * 60_000).toISOString(),
    isAllDay: false, location: '', status: 'confirmed', participants: [], isRecurring: false, keywords: [],
    ...extra,
  };
}

function allDay(id, title, date, extra = {}) {
  return {
    id, uid: id, calendarId: 'cal', title, description: '',
    start: `${date}T00:00:00`, timeZone: null, duration: 'P1D', utcStart: null, utcEnd: null,
    isAllDay: true, location: '', status: 'confirmed', participants: [], isRecurring: false, keywords: [],
    ...extra,
  };
}

const events = [
  timed('a', 'Standup', new Date(2026, 9, 14, 10, 0), 15, { location: 'Room 1' }),
  allDay('b', 'Offsite', '2026-10-15'),
  timed('c', 'Dropped', new Date(2026, 9, 15, 15, 30), 30, { status: 'cancelled' }),
];

function setup(slot, { getEvents = async () => events, settings = { daysAhead: 7 } } = {}) {
  const api = fakeApi({ translations: manifest.locales, settings, handlers: { 'calendar.getEvents': getEvents } });
  const Agenda = makeAgenda(React, api, { slot, now: NOW });
  return { api, Agenda };
}

async function show(Agenda) {
  await act(async () => { render(React.createElement(Agenda)); });
}

const rowTitles = () => [...document.body.firstChild.children].map((r) => r.getAttribute('title').split(' · ')[0]);

describe('position', () => {
  it('puts the left-sidebar agenda in a sidebar section', () => {
    expect(slotForPosition('Left sidebar')).toBe('sidebar-section');
    expect(slotForPosition(undefined)).toBe('sidebar-section');
    expect(slotForPosition('Top banner')).toBe('app-top-banner');
  });
});

describe('reading events', () => {
  it('asks api.calendar for today through the next N days, in the UTC form it accepts', async () => {
    const { api, Agenda } = setup('sidebar-section', { settings: { daysAhead: 3 } });
    await show(Agenda);
    const calls = api.calls('calendar.getEvents');
    expect(calls).toHaveLength(1);
    const range = calls[0].args[0];
    // The host refuses milliseconds and offsets: 2026-10-14T07:00:00Z only.
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(range.from)).toBe(new Date(2026, 9, 14).getTime());
    expect(Date.parse(range.to)).toBe(new Date(2026, 9, 17, 9, 0).getTime());
    expect(Object.keys(range)).toEqual(['from', 'to']);
  });

  it('does not POST to the app, which no plugin may do for the agenda', async () => {
    const { api, Agenda } = setup('sidebar-section');
    await show(Agenda);
    expect(api.calls('http.post')).toHaveLength(0);
    expect(manifest.permissions).not.toContain('http:post');
    expect(manifest.permissions).toContain('calendar:read');
    expect(manifest.apiPostPaths).toBeUndefined();
  });

  it('keeps running events, drops finished ones, sorts by start and caps the count', async () => {
    const list = [
      allDay('d', 'Holiday', '2026-10-16'),
      timed('e', 'Finished', new Date(2026, 9, 14, 7, 0), 60),
      timed('f', 'Running', new Date(2026, 9, 14, 8, 30), 60),
      timed('g', 'Later', new Date(2026, 9, 14, 18, 0), 60),
      allDay('h', 'Today all day', '2026-10-14'),
    ];
    const { Agenda } = setup('sidebar-section', { getEvents: async () => list, settings: { daysAhead: 7, maxEvents: 3 } });
    await show(Agenda);
    expect(rowTitles()).toEqual(['Today all day', 'Running', 'Later']);
  });

  it('places a timed event by its UTC start, not the wall clock of its own zone', async () => {
    const { Agenda } = setup('sidebar-section', { getEvents: async () => [events[0]] });
    await show(Agenda);
    const time = new Date(2026, 9, 14, 10, 0).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    expect(document.body.textContent).toBe(`Standup${time}`);
  });

  it('names an event without a title', async () => {
    const { Agenda } = setup('sidebar-section', { getEvents: async () => [timed('x', '  ', new Date(2026, 9, 14, 11, 0), 30)] });
    await show(Agenda);
    expect(rowTitles()).toEqual(['(No title)']);
  });

  it('reads ISO durations', () => {
    expect(durationMs('PT1H30M')).toBe(90 * 60_000);
    expect(durationMs('P1D')).toBe(86_400_000);
    expect(durationMs('P1W')).toBe(7 * 86_400_000);
    expect(durationMs('P1DT2H')).toBe(26 * 3_600_000);
    expect(durationMs('')).toBe(0);
  });
});

describe('sidebar section', () => {
  it('draws one sidebar row per event with when it starts, and no header of its own', async () => {
    const { Agenda } = setup('sidebar-section');
    await show(Agenda);
    const time = new Date(2026, 9, 14, 10, 0).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    const later = new Date(2026, 9, 15, 15, 30).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    const rows = [...document.body.firstChild.children];
    expect(rows.map((r) => r.textContent)).toEqual([`Standup${time}`, 'OffsiteTomorrow', `DroppedTomorrow ${later}`]);
    expect(rows[0].getAttribute('title')).toBe(`Standup · ${time} · Room 1`);
    expect(rows[2].querySelector('del').textContent).toBe('Dropped');
    // The host draws the header and folds the section.
    expect(screen.queryByText('Agenda')).toBeNull();
    expect(screen.queryByRole('button', { name: /collapse|expand|refresh/i })).toBeNull();
  });

  it('says so when there is nothing, in the sidebar empty line', async () => {
    const { Agenda } = setup('sidebar-section', { getEvents: async () => [] });
    await show(Agenda);
    expect(document.body.textContent).toBe('No events in the next 7 day(s).');
  });

  it('shows the sign-in hint when there is no session', async () => {
    const { Agenda } = setup('sidebar-section', {
      getEvents: async () => { throw new Error('calendar.getEvents: no active session'); },
    });
    await show(Agenda);
    expect(document.body.textContent).toBe('Sign in to see your agenda.');
  });
});

describe('reading pane and top banner', () => {
  it('lists events as rows with a subtitle in the reading pane', async () => {
    const { Agenda } = setup('email-detail-sidebar');
    await show(Agenda);
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toBe('OffsiteTomorrow');
  });

  it('shows an error as an alert in the reading pane', async () => {
    const { Agenda } = setup('email-detail-sidebar', { getEvents: async () => { throw new Error('boom'); } });
    await show(Agenda);
    expect(screen.getByRole('alert').textContent).toBe("Couldn't load agenda: boom");
  });

  it('puts the next events as chips in a compact info bar', async () => {
    const { Agenda } = setup('app-top-banner');
    await show(Agenda);
    const bar = document.querySelector('.bk-infobar');
    expect(bar.textContent.startsWith('Agenda')).toBe(true);
    expect(bar.querySelectorAll('span[title]')).toHaveLength(3);
  });
});
