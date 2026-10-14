// Links into the Paperless web app. They start with the base the request
// went to (the credential's server), so the host accepts them as the link
// of a notification.

/** A document's page. */
export function documentLink(base, id) {
  return `${base}/documents/${id}/details`;
}

/**
 * The document list filtered by title, for when the document id isn't
 * known. Paperless-ngx 2.x and 3.x read `title__icontains` from the list URL
 * as the "Title" filter (checked against 3.2.1).
 */
export function titleSearchLink(base, title) {
  const text = String(title || '').trim();
  return text ? `${base}/documents?title__icontains=${encodeURIComponent(text)}` : `${base}/documents`;
}
