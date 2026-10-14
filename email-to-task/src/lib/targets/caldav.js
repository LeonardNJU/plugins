// A CalDAV task list (VTODO), with the user's name and password.
//
// The task lists are found the way calendar apps find them (RFC 6764 and
// RFC 4791): the current user's principal, its calendar home, and the
// calendars there that take VTODO. The server proxy follows redirects but
// can't resend a PROPFIND body after a 307, so after /.well-known/caldav the
// usual server paths are tried too.

import { request, TaskError } from '../errors.js';
import { buildVtodo } from '../ical.js';
import { displayName, hrefIn, isTaskList, isTasksOnly, multistatus } from '../dav-xml.js';
import { priorityFor } from '../priority.js';
import { originOf, randomId } from './common.js';

const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?>'
  + '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
  + '<d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/>'
  + '<c:supported-calendar-component-set/></d:prop></d:propfind>';

const USUAL_PATHS = ['/.well-known/caldav', '/', '/dav/', '/dav/cal/', '/remote.php/dav/', '/dav.php/', '/caldav/', '/caldav.php/', '/cal.php/'];

async function propfind(ctx, url, depth) {
  const res = await request(ctx.api, 'caldav', url, {
    method: 'PROPFIND',
    headers: { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
    body: PROPFIND_BODY,
    responseType: 'text',
  });
  try {
    return multistatus(res.body);
  } catch {
    return [];
  }
}

/** An href from the server as an absolute URL on the connected server, or null. */
function resolve(ctx, href, base) {
  try {
    const url = new URL(href, base);
    return url.origin === ctx.origin ? url.toString() : null;
  } catch {
    return null;
  }
}

function listsIn(ctx, responses, base) {
  const out = [];
  for (const r of responses) {
    if (!isTaskList(r.props)) continue;
    const url = resolve(ctx, r.href, base);
    if (!url) continue;
    const name = displayName(r.props) || decodeURIComponent(url.replace(/\/+$/, '').split('/').pop() || url);
    out.push({ id: url.endsWith('/') ? url : `${url}/`, name, tasksOnly: isTasksOnly(r.props) });
  }
  // Lists made for tasks first: they are where people expect their to-dos.
  return out
    .sort((a, b) => Number(b.tasksOnly) - Number(a.tasksOnly))
    .map(({ id, name }) => ({ id, name }));
}

/** Errors that mean "not here, try the next address". */
function tryNext(err) {
  return ['not_found', 'bad_request', 'server', 'forbidden', 'conflict', 'wrong_server'].includes(err?.code);
}

/** The task lists, starting from the given addresses and then the usual ones. */
export async function discoverTaskLists(ctx, starts = []) {
  const candidates = [];
  for (const s of [...starts, ...USUAL_PATHS.map((p) => `${ctx.origin}${p}`)]) {
    if (s && originOf(s) === ctx.origin && !candidates.includes(s)) candidates.push(s);
  }
  for (const url of candidates) {
    let responses;
    try {
      responses = await propfind(ctx, url, 0);
    } catch (err) {
      if (tryNext(err)) continue;
      throw err;
    }
    // The address is a task list itself.
    const direct = listsIn(ctx, responses, url);
    if (direct.length) return direct;
    const props = responses[0]?.props ?? {};
    let home = props['calendar-home-set'] ? resolve(ctx, hrefIn(props['calendar-home-set']), url) : null;
    const principal = props['current-user-principal'] ? resolve(ctx, hrefIn(props['current-user-principal']), url) : null;
    if (!home && principal) {
      try {
        const p = await propfind(ctx, principal, 0);
        const set = p[0]?.props['calendar-home-set'];
        home = set ? resolve(ctx, hrefIn(set), principal) : null;
      } catch (err) {
        if (!tryNext(err)) throw err;
      }
    }
    if (!home) continue;
    try {
      const lists = listsIn(ctx, await propfind(ctx, home, 1), home);
      if (lists.length) return lists;
    } catch (err) {
      if (!tryNext(err)) throw err;
    }
  }
  return [];
}

export const caldav = {
  id: 'caldav',
  credentialId: 'caldav',
  name: 'CalDAV',
  suggestedServer: (config) => originOf(config.caldavUrl) ?? undefined,

  async containers(ctx) {
    return discoverTaskLists(ctx, [ctx.manualUrl, ctx.config.caldavUrl]);
  },

  async create(ctx, task) {
    if (!task.containerId || originOf(task.containerId) !== ctx.origin) throw new TaskError('no_task_list');
    const uid = `${randomId()}@bulwark-email-to-task`;
    const url = `${task.containerId.replace(/\/?$/, '/')}${encodeURIComponent(uid)}.ics`;
    await request(ctx.api, 'caldav', url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' },
      body: buildVtodo({
        uid,
        title: task.title,
        description: task.description,
        due: task.due,
        priority: priorityFor('caldav', task.priority),
        url: task.link,
      }),
    });
    return { taskId: url, url: null };
  },

  async exists(ctx, ref) {
    if (originOf(ref.taskId) !== ctx.origin) return null;
    try {
      await request(ctx.api, 'caldav', ref.taskId, { method: 'GET', responseType: 'text' });
      return true;
    } catch (err) {
      return err?.code === 'not_found' ? false : null;
    }
  },
};
