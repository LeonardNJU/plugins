// Follows Paperless consume tasks until the document is in or the import
// failed, and survives a page reload: open tasks are kept in plugin storage.

import { toPaperlessError } from './errors.js';

export const TASKS_KEY = 'tasks';
/** Give up on a task that is still pending after this long. */
export const TASK_TIMEOUT_MS = 15 * 60 * 1000;
/**
 * A task can report success a moment before it names the new document.
 * Keep asking this long for the id, then report without it.
 */
export const DOCUMENT_ID_WAIT_MS = 30 * 1000;
const MAX_TASKS = 100;

/**
 * @param {object} deps
 * @param {{ get: Function, set: Function }} deps.storage  api.storage
 * @param {(entry) => Promise<{ task: (id: string) => Promise<any> }>} deps.clientFor
 * @param {(entry, outcome: { state: 'success'|'failure'|'timeout'|'error', documentId?: number|null, error?: string, duplicateOf?: number|null, errorKey?: string }) => void} deps.onDone
 * @param {() => number} [deps.now]
 */
export function createTaskTracker({ storage, clientFor, onDone, now = () => Date.now(), timeoutMs = TASK_TIMEOUT_MS, idWaitMs = DOCUMENT_ID_WAIT_MS }) {
  let queue = Promise.resolve();
  // One read-modify-write at a time, so two uploads finishing together don't lose a task.
  const withList = (fn) => {
    const run = queue.then(async () => {
      const list = (await storage.get(TASKS_KEY)) || [];
      const result = await fn(Array.isArray(list) ? list : []);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };

  return {
    /** Remember a task to follow. */
    add(entry) {
      return withList(async (list) => {
        const next = [...list.filter((e) => e.taskId !== entry.taskId), { ...entry, startedAt: entry.startedAt ?? now() }].slice(-MAX_TASKS);
        await storage.set(TASKS_KEY, next);
        return next.length;
      });
    },

    pending() {
      return withList(async (list) => list);
    },

    /** Check every open task once. Resolves to how many are still open. */
    pollOnce() {
      return withList(async (list) => {
        const keep = [];
        let changed = false;
        for (let entry of list) {
          let outcome = null;
          try {
            const client = await clientFor(entry);
            const task = await client.task(entry.taskId);
            if (task.state === 'success') {
              if (task.documentId != null) {
                outcome = { state: 'success', documentId: task.documentId };
              } else if (entry.succeededAt == null) {
                // Filed, but the id isn't there yet: ask again next round.
                entry = { ...entry, succeededAt: now() };
                changed = true;
              } else if (now() - entry.succeededAt >= idWaitMs) {
                outcome = { state: 'success', documentId: null };
              }
            } else if (task.state === 'failure') outcome = { state: 'failure', error: task.error, duplicateOf: task.duplicateOf };
          } catch (err) {
            const e = toPaperlessError(err);
            // A revoked token or a removed connection won't fix itself.
            if (e.key === 'error.token' || e.key === 'error.not_connected') outcome = { state: 'error', errorKey: e.key };
          }
          if (!outcome && now() - (entry.startedAt || 0) > timeoutMs) {
            // Filed without an id is still filed.
            outcome = entry.succeededAt != null ? { state: 'success', documentId: null } : { state: 'timeout' };
          }
          if (outcome) {
            try { onDone(entry, outcome); } catch { /* the plugin's own notifier */ }
          } else {
            keep.push(entry);
          }
        }
        if (changed || keep.length !== list.length) await storage.set(TASKS_KEY, keep);
        return keep.length;
      });
    },
  };
}

/**
 * Polls while tasks are open: every 2 s for the first half minute, then
 * every 10 s. `start()` is safe to call again; only one loop runs.
 */
export function createPoller(tracker, { setTimer = setTimeout, fastMs = 2000, slowMs = 10000, fastFor = 15 } = {}) {
  let running = false;
  let rounds = 0;
  const tick = async () => {
    let open = 0;
    try { open = await tracker.pollOnce(); } catch { open = 1; }
    rounds++;
    if (open > 0) setTimer(tick, rounds < fastFor ? fastMs : slowMs);
    else running = false;
  };
  return {
    start() {
      rounds = 0;
      if (running) return;
      running = true;
      setTimer(tick, fastMs);
    },
    get running() { return running; },
  };
}
