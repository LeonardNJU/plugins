// A small Paperless-ngx REST client on top of api.proxy.fetch. The token
// never reaches the plugin: the server proxy adds `Authorization: Token ...`.

import { PaperlessError, errorFromResponse } from './errors.js';
import { buildMultipart } from './multipart.js';

export const PAGE_SIZE = 25;
const ACCEPT = 'application/json';

/** "https://dms.example.com/paperless/" → "https://dms.example.com/paperless", or '' when not a URL. */
export function normalizeBase(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let text = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
    return `${url.origin}${path}`;
  } catch {
    return '';
  }
}

/** The query string for a document search. */
export function documentQuery(filters = {}, page = 1, pageSize = PAGE_SIZE) {
  const q = new URLSearchParams();
  const text = (filters.text || '').trim();
  if (text) q.set('title_content', text);
  const tags = (filters.tags || []).filter((id) => Number.isInteger(id));
  if (tags.length) q.set('tags__id__all', tags.join(','));
  if (Number.isInteger(filters.correspondent)) q.set('correspondent__id__in', String(filters.correspondent));
  if (Number.isInteger(filters.documentType)) q.set('document_type__id__in', String(filters.documentType));
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.from || '')) q.set('created__date__gte', filters.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.to || '')) q.set('created__date__lte', filters.to);
  q.set('ordering', '-created');
  q.set('page', String(page));
  q.set('page_size', String(pageSize));
  q.set('fields', 'id,title,correspondent,document_type,tags,created,original_file_name,mime_type,content,page_count');
  return q.toString();
}

/**
 * Normalise a task from /api/tasks/?task_id= for Paperless 2.x (a list,
 * upper-case status, `result` text) and 3.x (a page, lower-case status,
 * `result_data`).
 * @returns {{ state: 'pending'|'success'|'failure'|'unknown', documentId: number|null, error: string, duplicateOf: number|null }}
 */
export function normalizeTask(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.results) ? json.results : [];
  const task = list[0];
  if (!task) return { state: 'unknown', documentId: null, error: '', duplicateOf: null };
  const status = String(task.status || '').toLowerCase();
  let documentId = null;
  const fromData = task.result_data?.document_id;
  if (Number.isInteger(fromData)) documentId = fromData;
  else if (Array.isArray(task.related_document_ids) && Number.isInteger(task.related_document_ids[0])) documentId = task.related_document_ids[0];
  else if (task.related_document != null && /^\d+$/.test(String(task.related_document))) documentId = Number(task.related_document);
  const resultText = typeof task.result === 'string' ? task.result : (task.result_data?.error_message || '');
  let duplicateOf = null;
  const dup = /duplicate of .*?\(#(\d+)\)/i.exec(resultText);
  if (dup) duplicateOf = Number(dup[1]);
  if (status === 'success') {
    if (documentId == null) {
      const m = /document id (\d+)/i.exec(resultText);
      if (m) documentId = Number(m[1]);
    }
    return { state: 'success', documentId, error: '', duplicateOf: null };
  }
  if (status === 'failure' || status === 'revoked') {
    return { state: 'failure', documentId: null, error: cleanTaskError(resultText), duplicateOf };
  }
  if (['pending', 'started', 'received', 'retry'].includes(status)) return { state: 'pending', documentId: null, error: '', duplicateOf: null };
  return { state: 'unknown', documentId: null, error: '', duplicateOf: null };
}

/** "t.eml: Error occurred while consuming document t.eml: Error while converting email to PDF: [Errno 111]..." → the useful part. */
export function cleanTaskError(text) {
  let msg = String(text || '').split('\n')[0].trim();
  msg = msg.replace(/^[^:]{1,255}: (?=(error|not consuming|unsupported|cannot|could not))/i, '');
  msg = msg.replace(/^Error occurred while consuming document [^:]+: /i, '');
  msg = msg.replace(/\[Errno \d+\]\s*/g, '');
  return msg.length > 200 ? `${msg.slice(0, 197)}...` : msg;
}

export function createClient({ proxyFetch, credentialId, base }) {
  if (!base) throw new PaperlessError('error.not_connected');

  async function request(path, { method = 'GET', headers = {}, body, responseType = 'json', signal, onProgress } = {}) {
    const url = /^https?:\/\//.test(path) ? path : `${base}${path}`;
    const init = { method, headers: { Accept: ACCEPT, ...headers }, responseType };
    if (body !== undefined) init.body = body;
    if (signal) init.signal = signal;
    if (onProgress) init.onProgress = onProgress;
    const res = await proxyFetch(credentialId, url, init);
    if (!res || !res.ok) throw errorFromResponse(res || { status: 0, headers: {} });
    return res;
  }

  // Asked for as text and parsed here: a proxy or server error page in HTML
  // would make the host's JSON parsing throw before the status is seen.
  async function json(path, opts) {
    const res = await request(path, { ...opts, responseType: 'text' });
    const text = typeof res.body === 'string' ? res.body : '';
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new PaperlessError('error.not_paperless', {}, res.status);
    }
  }

  /** Every entry of a list endpoint, page by page (by number, not the absolute `next` URL). */
  async function listAll(path, max = 2000) {
    const out = [];
    for (let page = 1; out.length < max; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await json(`${path}${sep}page=${page}&page_size=250`);
      const results = Array.isArray(data) ? data : data?.results ?? [];
      out.push(...results);
      if (Array.isArray(data) || !data?.next || results.length === 0) break;
    }
    return out;
  }

  const pick = (rows) => rows.map((r) => ({
    id: r.id, name: String(r.name ?? ''), match: String(r.match ?? ''), matchingAlgorithm: r.matching_algorithm ?? 0,
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    base,
    credentialId,
    request,

    /** Who the token belongs to; also checks the connection. */
    async whoAmI() {
      const data = await json('/api/ui_settings/');
      return { username: data?.user?.username || '', version: data?.settings?.version || '' };
    },

    async taxonomies() {
      const [tags, correspondents, documentTypes, storagePaths] = await Promise.all([
        listAll('/api/tags/?fields=id,name,match,matching_algorithm,color'),
        listAll('/api/correspondents/?fields=id,name,match,matching_algorithm'),
        listAll('/api/document_types/?fields=id,name,match,matching_algorithm'),
        listAll('/api/storage_paths/?fields=id,name,match,matching_algorithm').catch(() => []),
      ]);
      return { tags: pick(tags), correspondents: pick(correspondents), documentTypes: pick(documentTypes), storagePaths: pick(storagePaths) };
    },

    async searchDocuments(filters, page = 1, pageSize = PAGE_SIZE) {
      const data = await json(`/api/documents/?${documentQuery(filters, page, pageSize)}`);
      const results = Array.isArray(data?.results) ? data.results : [];
      return { count: data?.count ?? results.length, results, hasMore: !!data?.next };
    },

    /** The first document with this content, by SHA-256 (Paperless 3) or MD5 (older). */
    async findByChecksum({ sha256, md5 }) {
      for (const sum of [sha256, md5]) {
        if (!sum) continue;
        const data = await json(`/api/documents/?checksum__iexact=${encodeURIComponent(sum)}&fields=id,title&page_size=1`);
        const hit = data?.results?.[0];
        if (hit) return { id: hit.id, title: String(hit.title ?? '') };
      }
      return null;
    },

    /**
     * Hand a file to Paperless. Resolves to the consume task's id.
     * @param {{ data: Uint8Array|ArrayBuffer, name: string, type?: string, title?: string, correspondent?: number|null,
     *   documentType?: number|null, storagePath?: number|null, tags?: number[], created?: string }} doc
     */
    async upload(doc, { signal, onProgress } = {}) {
      const fields = [['document', { filename: doc.name, type: doc.type, data: doc.data }]];
      if (doc.title) fields.push(['title', doc.title.slice(0, 128)]);
      if (doc.created) fields.push(['created', doc.created]);
      if (Number.isInteger(doc.correspondent)) fields.push(['correspondent', doc.correspondent]);
      if (Number.isInteger(doc.documentType)) fields.push(['document_type', doc.documentType]);
      if (Number.isInteger(doc.storagePath)) fields.push(['storage_path', doc.storagePath]);
      for (const tag of doc.tags || []) if (Number.isInteger(tag)) fields.push(['tags', tag]);
      const { body, contentType } = buildMultipart(fields);
      const res = await request('/api/documents/post_document/', {
        method: 'POST', headers: { 'Content-Type': contentType }, body, responseType: 'text', signal, onProgress,
      });
      let taskId = String(res.body ?? '').trim();
      try { const parsed = JSON.parse(taskId); if (typeof parsed === 'string') taskId = parsed; else if (parsed?.task_id) taskId = parsed.task_id; } catch { /* plain text */ }
      if (!/^[0-9a-f-]{8,64}$/i.test(taskId)) throw new PaperlessError('error.unexpected', { detail: 'no task id' });
      return taskId;
    },

    async task(taskId) {
      return normalizeTask(await json(`/api/tasks/?task_id=${encodeURIComponent(taskId)}`));
    },

    async document(id) {
      return json(`/api/documents/${id}/`);
    },

    async thumbnail(id, signal) {
      const res = await request(`/api/documents/${id}/thumb/`, { responseType: 'arraybuffer', signal });
      return { data: res.body, type: res.headers?.['content-type'] || 'image/webp' };
    },

    async preview(id, signal) {
      const res = await request(`/api/documents/${id}/preview/`, { responseType: 'arraybuffer', signal });
      return { data: res.body, type: res.headers?.['content-type'] || 'application/pdf' };
    },

    /** The original file with its name from Content-Disposition. */
    async download(id, fallbackName = 'document') {
      const res = await request(`/api/documents/${id}/download/?original=true`, { responseType: 'arraybuffer' });
      const type = (res.headers?.['content-type'] || 'application/octet-stream').split(';')[0].trim();
      return { data: res.body, type, name: filenameFromDisposition(res.headers?.['content-disposition']) || fallbackName };
    },

    documentUrl(id) {
      return `${base}/documents/${id}/details`;
    },
  };
}

/** The file name in a Content-Disposition header, preferring RFC 5987 filename*. */
export function filenameFromDisposition(header) {
  if (typeof header !== 'string') return '';
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[2].trim()); } catch { /* fall through */ }
  }
  const plain = /filename\s*=\s*"((?:[^"\\]|\\.)*)"|filename\s*=\s*([^;]+)/i.exec(header);
  if (plain) return (plain[1] ?? plain[2] ?? '').replace(/\\(.)/g, '$1').trim();
  return '';
}
