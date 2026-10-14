// Todoist, API v1 (https://developer.todoist.com/api/v1/) with a personal API token.

import { request, TaskError } from '../errors.js';
import { priorityFor } from '../priority.js';
import { baseOn, originOf } from './common.js';

export const TODOIST_API = 'https://api.todoist.com/api/v1';

function apiBase(ctx) {
  return baseOn(ctx.origin, ctx.config.todoistApiUrl || TODOIST_API, '/api/v1');
}

export const todoist = {
  id: 'todoist',
  credentialId: 'todoist',
  name: 'Todoist',
  suggestedServer: (config) => originOf(config.todoistApiUrl || TODOIST_API) ?? undefined,

  async containers(ctx) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const res = await request(ctx.api, 'todoist', `${apiBase(ctx)}/projects${query}`, { responseType: 'json' });
      const results = Array.isArray(res.body?.results) ? res.body.results : [];
      for (const p of results) {
        if (p?.id && !p.is_archived) out.push({ id: String(p.id), name: String(p.name ?? p.id), inbox: !!p.inbox_project });
      }
      cursor = res.body?.next_cursor;
      if (!cursor) break;
    }
    // The inbox first, as Todoist shows it.
    return out.sort((a, b) => Number(b.inbox) - Number(a.inbox)).map(({ id, name }) => ({ id, name }));
  },

  async create(ctx, task) {
    const body = {
      content: task.title.slice(0, 500),
      description: task.description,
      priority: priorityFor('todoist', task.priority),
      ...(task.containerId ? { project_id: task.containerId } : {}),
      ...(task.due ? { due_date: task.due } : {}),
    };
    const res = await request(ctx.api, 'todoist', `${apiBase(ctx)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      responseType: 'json',
    });
    const id = res.body?.id;
    if (!id) throw new TaskError('server', { detail: 'no task id in the answer' });
    // The web app link only exists for the real service.
    const url = ctx.origin === originOf(TODOIST_API) ? `https://app.todoist.com/app/task/${encodeURIComponent(id)}` : null;
    return { taskId: String(id), url };
  },

  async exists(ctx, ref) {
    try {
      await request(ctx.api, 'todoist', `${apiBase(ctx)}/tasks/${encodeURIComponent(ref.taskId)}`, { responseType: 'json' });
      return true;
    } catch (err) {
      return err?.code === 'not_found' ? false : null;
    }
  },
};
