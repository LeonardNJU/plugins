// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { TaskDialog } from '../src/ui/task-dialog.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { locales } = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

const EMAIL = { id: 'M1', subject: 'Re: Quarterly report', from: [{ name: 'Carol', email: 'carol@example.org' }], receivedAt: '2026-10-14T09:00:00', text: 'Could you send the report by Friday?', headers: {} };

function makeApi({ accounts = [{ credentialId: 'vikunja', origin: 'http://localhost:18456', connected: true }], fetch, locale = 'en', connect } = {}) {
  return fakeApi({
    locale,
    translations: locales,
    handlers: {
      'email.get': async (id) => (id === 'M1' ? EMAIL : null),
      'proxy.accounts': async () => (typeof accounts === 'function' ? accounts() : accounts),
      'admin.getAllConfig': async () => ({}),
      'tasks.list': async () => { throw new Error('no calendars'); },
      'proxy.fetch': fetch ?? (async (id, url) => (url.includes('/projects?') ? proxyResponse([{ id: 2, title: 'Bulwark inbox' }]) : proxyResponse({ id: 77 }))),
      'proxy.connect': connect ?? (async () => ({ connected: true })),
      'email.setKeyword': async () => {},
    },
  });
}

async function open(api, emailIds = ['M1']) {
  const onResult = vi.fn();
  await act(async () => { render(React.createElement(TaskDialog, { api, emailIds, onResult })); });
  await screen.findByLabelText('Title');
  return onResult;
}

describe('TaskDialog', () => {
  it('is filled in from the message and creates the task in Vikunja', async () => {
    const api = makeApi();
    const onResult = await open(api);
    expect(screen.getByLabelText('Title').value).toBe('Quarterly report');
    expect(screen.getByLabelText('Due date').value).toBe('2026-10-16');
    expect(screen.getByText('Found in the message: “by Friday”')).toBeTruthy();
    expect(screen.getByLabelText('Description').value).toContain('/mail/message/M1');
    await screen.findByRole('option', { name: 'Bulwark inbox' });
    // Bulwark tasks are not offered: this server has none.
    expect(screen.queryByRole('option', { name: 'Tasks (Bulwark)' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Send the report' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create task' })); });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ created: ['M1'] }));
    const put = api.calls('proxy.fetch').find((c) => c.args[2]?.method === 'PUT');
    expect(put.args[1]).toBe('http://localhost:18456/api/v1/projects/2/tasks');
    expect(JSON.parse(put.args[2].body).title).toBe('Send the report');
    expect(api.calls('toast.success')[0].args[0]).toBe('Task created in Vikunja');
  });

  it('asks to connect a service that is not connected, and then loads its projects', async () => {
    let accounts = [];
    const api = makeApi({
      accounts: () => accounts,
      connect: async () => { accounts = [{ credentialId: 'todoist', origin: 'http://localhost:18099', connected: true }]; return { connected: true }; },
      fetch: async () => proxyResponse({ results: [{ id: 'in', name: 'Inbox', inbox_project: true }], next_cursor: null }),
    });
    await open(api);
    fireEvent.change(screen.getByLabelText('Add to'), { target: { value: 'todoist' } });
    const button = await screen.findByRole('button', { name: 'Connect Todoist' });
    expect(screen.getByRole('button', { name: 'Create task' }).disabled).toBe(true);
    await act(async () => { fireEvent.click(button); });
    expect(api.calls('proxy.connect')[0].args).toEqual(['todoist', { mode: 'password', server: 'https://api.todoist.com' }]);
    expect(await screen.findByRole('option', { name: 'Inbox' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Todoist' })).toBeNull();
  });

  it('shows a rejected token in plain words with a way to connect again', async () => {
    const api = makeApi({
      fetch: async (id, url) => (url.includes('/projects?') ? proxyResponse([{ id: 2, title: 'P' }]) : proxyResponse({ message: 'invalid token' }, { status: 401 })),
    });
    const onResult = await open(api);
    await screen.findByRole('option', { name: 'P' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create task' })); });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Vikunja did not accept the saved password or token');
    expect(alert.textContent).not.toMatch(/401|Error|stack/);
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('creates with Enter in the title field (the sandbox has no form submission)', async () => {
    const api = makeApi();
    const onResult = await open(api);
    await screen.findByRole('option', { name: 'Bulwark inbox' });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' }); });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ created: ['M1'] }));
  });

  it('asks for a task list address when CalDAV has none, and does not create meanwhile', async () => {
    const api = makeApi({
      accounts: [{ credentialId: 'caldav', origin: 'http://localhost:18025', connected: true }],
      fetch: async () => proxyResponse('', { status: 404 }),
    });
    await open(api);
    fireEvent.change(screen.getByLabelText('Add to'), { target: { value: 'caldav' } });
    expect(await screen.findByText(/No task list was found on this server/)).toBeTruthy();
    expect(screen.getByLabelText('Task list address')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create task' }).disabled).toBe(true);
  });

  it('speaks German', async () => {
    const api = makeApi({ locale: 'de' });
    const onResult = vi.fn();
    await act(async () => { render(React.createElement(TaskDialog, { api, emailIds: ['M1'], onResult })); });
    expect(await screen.findByLabelText('Titel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aufgabe erstellen' })).toBeTruthy();
    expect(screen.getByLabelText('Fälligkeitsdatum').value).toBe('2026-10-16');
  });
});
