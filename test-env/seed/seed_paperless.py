"""Seed the test Paperless-ngx: API token, tags, correspondents, document types,
a storage path and a handful of PDF documents.

    python seed/seed_paperless.py

Idempotent: objects are looked up by name and documents by title before
anything is created.
"""
import os
import sys
import time
import uuid
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import http, minimal_pdf, wait_for, write_secret  # noqa: E402

BASE = os.environ.get('PAPERLESS_URL', 'http://localhost:18010')
ADMIN = ('admin', os.environ.get('PAPERLESS_ADMIN_PASSWORD', 'admin-pass-123'))

TAGS = [('Invoice', '#e11d48'), ('Contract', '#2563eb'), ('Tax', '#16a34a'),
        ('Inbox', '#f59e0b'), ('Bulwark test', '#7c3aed')]
CORRESPONDENTS = ['ACME Hosting', 'Stadtwerke Hildesheim', 'Finanzamt', 'Bob Example']
DOCUMENT_TYPES = ['Invoice', 'Contract', 'Letter', 'Receipt']
STORAGE_PATH = ('By correspondent', '{{ correspondent }}/{{ created_year }}/{{ title }}')

DOCUMENTS = [
    # title, correspondent, document type, tags, created
    ('ACME invoice 2026-09', 'ACME Hosting', 'Invoice', ['Invoice', 'Bulwark test'], '2026-09-01'),
    ('ACME invoice 2026-10', 'ACME Hosting', 'Invoice', ['Invoice', 'Inbox'], '2026-10-01'),
    ('Strom Abschlag 2026', 'Stadtwerke Hildesheim', 'Letter', ['Bulwark test'], '2026-02-15'),
    ('Hosting contract', 'ACME Hosting', 'Contract', ['Contract'], '2025-12-01'),
    ('Steuerbescheid 2025', 'Finanzamt', 'Letter', ['Tax'], '2026-06-20'),
    ('Coffee receipt', 'Bob Example', 'Receipt', [], '2026-10-10'),
]


class Api:
    def __init__(self, token):
        self.headers = {'Authorization': f'Token {token}', 'Accept': 'application/json; version=9'}

    def get(self, path):
        r = http('GET', BASE + path, headers=self.headers)
        if r.status != 200:
            sys.exit(f'GET {path}: {r.status} {r.text[:300]}')
        return r.json()

    def post(self, path, body, extra=None):
        r = http('POST', BASE + path, body=body, headers={**self.headers, **(extra or {})})
        if r.status not in (200, 201):
            sys.exit(f'POST {path}: {r.status} {r.text[:300]}')
        return r.json()

    def ensure(self, endpoint, name, extra=None):
        found = self.get(f'/api/{endpoint}/?name__iexact={quote(name)}')['results']
        if found:
            return found[0]['id']
        obj = self.post(f'/api/{endpoint}/', {'name': name, **(extra or {})})
        print(f'paperless: created {endpoint[:-1]} {name}')
        return obj['id']


def multipart(fields, file_field, filename, data):
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; '
                 f'filename="{filename}"\r\nContent-Type: application/pdf\r\n\r\n'.encode() + data + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'


def main():
    wait_for('Paperless', lambda: http('GET', f'{BASE}/api/').status in (200, 302, 401, 403))
    r = None

    def token_ready():
        nonlocal r
        r = http('POST', f'{BASE}/api/token/', body={'username': ADMIN[0], 'password': ADMIN[1]})
        return r.status == 200
    # The admin user is created by the container's init a few seconds after
    # the web server answers.
    wait_for('Paperless admin user', token_ready, timeout=180)
    token = r.json()['token']
    api = Api(token)

    tags = {name: api.ensure('tags', name, {'color': color, 'matching_algorithm': 0}) for name, color in TAGS}
    corrs = {name: api.ensure('correspondents', name, {'matching_algorithm': 0}) for name in CORRESPONDENTS}
    types = {name: api.ensure('document_types', name, {'matching_algorithm': 0}) for name in DOCUMENT_TYPES}
    storage = api.ensure('storage_paths', STORAGE_PATH[0], {'path': STORAGE_PATH[1], 'matching_algorithm': 0})

    tasks = []
    for title, corr, dtype, tag_names, created in DOCUMENTS:
        if api.get(f'/api/documents/?title__iexact={quote(title)}')['count']:
            continue
        fields = [('title', title), ('correspondent', corrs[corr]), ('document_type', types[dtype]),
                  ('storage_path', storage), ('created', created)]
        fields += [('tags', tags[t]) for t in tag_names]
        pdf = minimal_pdf([title, f'From: {corr}', f'Date: {created}', f'Type: {dtype}'])
        body, ctype = multipart(fields, 'document', title.replace(' ', '-') + '.pdf', pdf)
        task_id = api.post('/api/documents/post_document/', body, {'Content-Type': ctype})
        if isinstance(task_id, dict):
            task_id = task_id.get('task_id') or task_id.get('id')
        tasks.append((title, task_id))
        print('paperless: uploaded', title)

    # Wait until every upload has been consumed.
    deadline = time.time() + 300
    for title, task_id in tasks:
        while True:
            found = api.get(f'/api/tasks/?task_id={task_id}')
            items = found if isinstance(found, list) else found.get('results', [])
            status = items[0]['status'] if items else 'PENDING'
            if status == 'SUCCESS':
                break
            if status in ('FAILURE', 'REVOKED'):
                sys.exit(f'paperless: consuming {title} failed: {items[0].get("result")}')
            if time.time() > deadline:
                sys.exit(f'paperless: consuming {title} timed out (status {status})')
            time.sleep(2)

    count = api.get('/api/documents/?page_size=1')['count']
    path = write_secret('paperless', {
        'url': BASE,
        'admin': {'user': ADMIN[0], 'password': ADMIN[1]},
        'token': token,
        'documents': count,
        'tags': tags,
        'correspondents': corrs,
        'documentTypes': types,
        'storagePath': storage,
    })
    print(f'paperless: ok, {count} documents, token {token} (saved to {path})')


if __name__ == '__main__':
    main()
