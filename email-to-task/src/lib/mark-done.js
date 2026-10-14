// What happens to the message once its task exists.

/** The keyword added to a message that has a task. Other mail apps can filter on it. */
export const TASK_KEYWORD = '$task';

/** The choices the dialog offers, in order. */
export const AFTER_CHOICES = ['keyword', 'read', 'both', 'none'];

/** Mark messages: 'keyword', 'read', 'both' or 'none'. Resolves to the ids that failed. */
export async function markMessages(api, emailIds, after) {
  const failed = [];
  if (!after || after === 'none') return failed;
  for (const id of emailIds) {
    try {
      if (after === 'keyword' || after === 'both') await api.email.setKeyword(id, TASK_KEYWORD);
      if (after === 'read' || after === 'both') await api.email.setKeyword(id, '$seen');
    } catch {
      failed.push(id);
    }
  }
  return failed;
}
