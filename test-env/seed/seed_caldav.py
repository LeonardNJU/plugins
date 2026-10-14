"""Seed a CalDAV task list (VTODO only) for alice on the test Stalwart.

    python seed/seed_caldav.py

Stalwart serves CalDAV at /dav/cal/<account>/ and accepts VTODO, so no extra
server is needed. Idempotent: the list is created with MKCALENDAR only when it
is missing, and tasks are PUT with If-None-Match so existing ones are kept.
"""
import os
import sys
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import http, wait_for, write_secret  # noqa: E402

BASE = os.environ.get('STALWART_URL', 'http://localhost:18025')
USER = 'alice@example.org'
PASSWORD = os.environ.get('TEST_ACCOUNT_PASSWORD', 'test-pass-123')
AUTH = (USER, PASSWORD)
HOME = f'{BASE}/dav/cal/{quote(USER)}/'
LIST = HOME + 'tasks/'

MKCALENDAR = '''<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set><d:prop>
    <d:displayname>Tasks</d:displayname>
    <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
  </d:prop></d:set>
</c:mkcalendar>'''

TASKS = [
    ('bpt-seed-task-1', 'Send slides to Carol', '20261021T150000Z', 'NEEDS-ACTION'),
    ('bpt-seed-task-2', 'Pay ACME invoice 2026-10', '20261031T120000Z', 'NEEDS-ACTION'),
    ('bpt-seed-task-3', 'Book train to Hildesheim', None, 'COMPLETED'),
]


def vtodo(uid, summary, due, status):
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bulwark plugin tests//seed//EN',
             'BEGIN:VTODO', f'UID:{uid}', 'DTSTAMP:20261014T000000Z', f'SUMMARY:{summary}',
             f'STATUS:{status}']
    if due:
        lines.append(f'DUE:{due}')
    if status == 'COMPLETED':
        lines += ['COMPLETED:20261013T080000Z', 'PERCENT-COMPLETE:100']
    lines += ['END:VTODO', 'END:VCALENDAR']
    return '\r\n'.join(lines) + '\r\n'


def main():
    wait_for('Stalwart', lambda: http('GET', f'{BASE}/jmap/session', auth=AUTH).status == 200)

    r = http('PROPFIND', LIST, headers={'Depth': '0'}, auth=AUTH)
    if r.status == 404:
        r = http('MKCALENDAR', LIST, body=MKCALENDAR, auth=AUTH,
                 headers={'Content-Type': 'application/xml; charset=utf-8'})
        if r.status != 201:
            sys.exit(f'caldav MKCALENDAR: {r.status} {r.text}')
        print('caldav: created task list', LIST)
    elif r.status != 207:
        sys.exit(f'caldav PROPFIND: {r.status} {r.text}')

    for uid, summary, due, status in TASKS:
        r = http('PUT', f'{LIST}{uid}.ics', body=vtodo(uid, summary, due, status), auth=AUTH,
                 headers={'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*'})
        if r.status in (201, 204):
            print('caldav: created task', summary)
        elif r.status != 412:  # 412: already there
            sys.exit(f'caldav PUT {uid}: {r.status} {r.text}')

    path = write_secret('caldav', {
        'url': BASE,
        'principal': f'{BASE}/dav/pal/{quote(USER)}/',
        'calendarHome': HOME,
        'taskList': LIST,
        'user': USER,
        'password': PASSWORD,
    })
    print(f'caldav: ok, task list {LIST} (saved to {path})')


if __name__ == '__main__':
    main()
