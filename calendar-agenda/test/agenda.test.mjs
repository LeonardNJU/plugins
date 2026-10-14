// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeAgenda, slotForPosition } from '../src/lib/agenda.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'calendar-agenda', 'manifest.json'), 'utf8'));
const NOW = () => new Date(2026, 9, 14, 9, 0);

afterEach(cleanup);

const events = [
  { id: 'a', title: 'Standup', start: new Date(2026, 9, 14, 10, 0).toISOString(), location: 'Room 1' },
  { id: 'b', title: 'Offsite', start: new Date(2026, 9, 15, 0, 0).toISOString(), allDay: true },
  { id: 'c', title: 'Dropped', start: new Date(2026, 9, 15, 15, 30).toISOString(), status: 'cancelled' },
];

function setup(slot, response = { ok: true, status: 200, data: { events } }) {
  const api = fakeApi({ translations: manifest.locales, settings: { daysAhead: 7 }, handlers: { 'http.post': async () => response } });
  const Agenda = makeAgenda(React, api, { slot, now: NOW });
  return { api, Agenda };
}

async function show(Agenda) {
  await act(async () => { render(React.createElement(Agenda)); });
}

describe('position', () => {
  it('puts the left-sidebar agenda in a sidebar section', () => {
    expect(slotForPosition('Left sidebar')).toBe('sidebar-section');
    expect(slotForPosition(undefined)).toBe('sidebar-section');
    expect(slotForPosition('Top banner')).toBe('app-top-banner');
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
    const { Agenda } = setup('sidebar-section', { ok: true, status: 200, data: { events: [] } });
    await show(Agenda);
    expect(document.body.textContent).toBe('No events in the next 7 day(s).');
  });

  it('shows the sign-in hint on 401', async () => {
    const { Agenda } = setup('sidebar-section', { ok: false, status: 401 });
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
    const { Agenda } = setup('email-detail-sidebar', { ok: false, status: 500, data: { error: 'boom' } });
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
