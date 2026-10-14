// Vikunja (https://vikunja.io), API v1 with an API token.

import { request, TaskError } from '../errors.js';
import { textToHtml } from '../message.js';
import { priorityFor } from '../priority.js';
import { baseOn, noonOf, trimSlash, originOf } from './common.js';

const PAGE = 50;

function apiBase(ctx) {
  return `${baseOn(ctx.origin, ctx.config.vikunjaUrl)}/api/v1`;
}

function frontendBase(ctx) {
  return baseOn(ctx.origin, ctx.config.vikunjaUrl);
}

export const vikunja = {
  id: 'vikunja',
  credentialId: 'vikunja',
  name: 'Vikunja',
  suggestedServer: (config) => originOf(config.vikunjaUrl) ?? undefined,

  /** Projects a task can go into (saved filters, which have negative ids, can't take tasks). */
  async containers(ctx) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const res = await request(ctx.api, 'vikunja', `${apiBase(ctx)}/projects?page=${page}&per_page=${PAGE}`, { responseType: 'json' });
      const list = Array.isArray(res.body) ? res.body : [];
      for (const p of list) {
        if (typeof p?.id === 'number' && p.id > 0 && !p.is_archived) out.push({ id: String(p.id), name: String(p.title ?? p.id) });
      }
      if (list.length < PAGE) break;
    }
    return out;
  },

  async create(ctx, task) {
    if (!task.containerId) throw new TaskError('no_project');
    const body = {
      title: task.title,
      description: textToHtml(task.description),
      priority: priorityFor('vikunja', task.priority),
      ...(task.due ? { due_date: noonOf(task.due) } : {}),
    };
    const res = await request(ctx.api, 'vikunja', `${apiBase(ctx)}/projects/${encodeURIComponent(task.containerId)}/tasks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      responseType: 'json',
    });
    const id = res.body?.id;
    if (id === undefined || id === null) throw new TaskError('server', { detail: 'no task id in the answer' });
    return { taskId: String(id), url: `${trimSlash(frontendBase(ctx))}/tasks/${id}` };
  },

  /** true, false (deleted) or null (can't tell right now). */
  async exists(ctx, ref) {
    try {
      await request(ctx.api, 'vikunja', `${apiBase(ctx)}/tasks/${encodeURIComponent(ref.taskId)}`, { responseType: 'json' });
      return true;
    } catch (err) {
      return err?.code === 'not_found' ? false : null;
    }
  },
};
