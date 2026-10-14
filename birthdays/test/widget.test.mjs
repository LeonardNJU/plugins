// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { makeWidget } from '../src/lib/widget.js';

// jsdom gives import.meta.url an http scheme; tests run from the repo root.
const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'birthdays', 'manifest.json'), 'utf8'));
const NOW = () => new Date(2026, 9, 14, 9, 0); // October 14, 2026

const person = (id, name, date, email) => ({
  id, kind: 'individual', addressBookIds: { b: true }, name: { full: name },
  ...(email ? { emails: { e: { address: email } } } : {}),
  anniversaries: { a: { kind: 'birth', date } },
});

function setup(contacts, { settings = {}, locale = 'en', fail = null, onGreet = null } = {}) {
  const api = fakeApi({
    locale,
    settings,
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => {
        if (fail) throw new Error(fail);
        return contacts;
      },
    },
  });
  const Widget = makeWidget(React, api, { now: NOW, onGreet });
  return { api, Widget };
}

async function show(Widget) {
  await act(async () => { render(React.createElement(Widget)); });
}

afterEach(cleanup);

describe('sidebar section', () => {
  it('lists upcoming birthdays from all address books, soonest first, as sidebar rows', async () => {
    const { api, Widget } = setup([
      person('1', 'Zoe Later', { month: 10, day: 30 }),
      person('2', 'Ada Today', { year: 1990, month: 10, day: 14 }),
      person('4', 'Tom Tomorrow', { month: 10, day: 15 }),
      person('3', 'Far Away', { month: 3, day: 1 }),
    ]);
    await show(Widget);
    // No address book id: the host lists every address book of the account.
    expect(api.calls('contacts.list')[0].args).toEqual([]);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-birthday'))).toEqual(['2', '4', '1']);
    // Name, then a short detail like a folder's count: Today, Tomorrow or the date.
    expect(rows.map((r) => r.textContent)).toEqual(['Ada TodayToday', 'Tom TomorrowTomorrow', 'Zoe LaterOct 30']);
    // The full line, with the age, is the tooltip.
    expect(rows[0].firstChild.getAttribute('title')).toBe('Ada Today: Today · October 14 · turns 36');
    expect(rows[2].firstChild.getAttribute('title')).toBe('Zoe Later: In 16 days · October 30');
    // The host draws the section header; the plugin draws no heading of its own.
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('list').getAttribute('aria-label')).toBe('Upcoming birthdays');
  });

  it('looks as far ahead as the setting says', async () => {
    const { Widget } = setup([person('1', 'Zoe', { month: 10, day: 30 })], { settings: { widgetDays: 10 } });
    await show(Widget);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No birthdays coming up.')).toBeTruthy();
  });

  it('shows five rows and the rest on request', async () => {
    const many = Array.from({ length: 7 }, (_, i) => person(String(i), `P${i}`, { month: 10, day: 15 + i }));
    const { Widget } = setup(many);
    await show(Widget);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show all (7)' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('speaks the user language, with plural forms for the age', async () => {
    const { Widget } = setup([person('1', 'Иван', { year: 2001, month: 10, day: 16 })], { locale: 'ru' });
    await show(Widget);
    const row = screen.getByRole('listitem');
    expect(row.textContent).toContain('16 окт');
    const title = row.firstChild.getAttribute('title');
    expect(title).toContain('Послезавтра');
    expect(title).toContain('исполняется 25 лет');
  });

  it('sends a greeting when a row with an address is clicked', async () => {
    const greeted = [];
    const { Widget } = setup([
      person('1', 'Ada Mail', { month: 10, day: 14 }, 'ada@example.org'),
      person('2', 'Bo NoMail', { month: 10, day: 15 }),
    ], { onGreet: async (b) => { greeted.push(b); } });
    await show(Widget);
    const [ada, bo] = screen.getAllByRole('listitem');
    // Only the contact with an address is a button; the tooltip says what it does.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(ada.firstChild.tagName).toBe('BUTTON');
    expect(ada.firstChild.getAttribute('title')).toBe('Ada Mail: Today · October 14\nSend Ada Mail a birthday greeting');
    expect(bo.firstChild.tagName).not.toBe('BUTTON');
    // Screen readers hear what the click does.
    expect(screen.getByRole('button', { name: 'Send Ada Mail a birthday greeting (Today · October 14)' })).toBe(ada.firstChild);
    fireEvent.click(ada.firstChild);
    expect(greeted.map((b) => [b.key, b.email])).toEqual([['1', 'ada@example.org']]);
  });

  it('says in plain words when contacts cannot be loaded, and retries', async () => {
    const { api, Widget } = setup([], { fail: 'API call contact.list timed out after 30s' });
    await show(Widget);
    expect(screen.getByRole('alert').textContent).toBe('The server took too long to answer. Try again in a moment.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(api.calls('contacts.list')).toHaveLength(2);
  });
});
