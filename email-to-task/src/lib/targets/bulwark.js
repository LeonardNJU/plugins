// The webmail's own tasks (api.tasks): tasks in the user's calendars on the
// mail server, over JMAP. Not every server has them, so this target is only
// offered after a probe succeeded.

import { TaskError, toTaskError } from '../errors.js';
import { priorityFor } from '../priority.js';

export const bulwark = {
  id: 'bulwark',
  credentialId: null,
  name: 'Bulwark',

  /**
   * Whether the server keeps tasks. api.tasks.list throws when the server or
   * the account has no calendars; a server without a calendar to put a
   * task in fails on create, which `create` reports as no_task_list.
   */
  async available(api) {
    try {
      const list = await api.tasks.list({ includeCompleted: false });
      return Array.isArray(list);
    } catch {
      return false;
    }
  },

  async containers() {
    return [];
  },

  async create(ctx, task) {
    let created;
    try {
      created = await ctx.api.tasks.create({
        title: task.title.slice(0, 500),
        description: task.description.slice(0, 10000),
        ...(task.due ? { due: task.due } : {}),
        priority: priorityFor('bulwark', task.priority),
      });
    } catch (err) {
      throw toTaskError(err);
    }
    // null: another plugin stopped it.
    if (!created) throw new TaskError('stopped');
    return { taskId: created.id, url: null };
  },

  async exists(ctx, ref) {
    try {
      return !!(await ctx.api.tasks.get(ref.taskId));
    } catch {
      return null;
    }
  },
};
