"""Seed the test Nextcloud: user alice, an app password, files and a share link.

    python seed/seed_nextcloud.py

Idempotent: existing users, files and shares are kept, and the app password in
.secrets/nextcloud.json is reused while it still works.
"""
import json
import os
import sys
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import docker_exec, http, minimal_pdf, minimal_png, read_secret, wait_for, write_secret  # noqa: E402

CONTAINER = 'bpt-nextcloud'
BASE = os.environ.get('NEXTCLOUD_URL', 'http://localhost:18080')
ADMIN = ('admin', os.environ.get('NEXTCLOUD_ADMIN_PASSWORD', 'admin-pass-123'))
USER = 'alice'
PASSWORD = os.environ.get('NEXTCLOUD_ALICE_PASSWORD', 'alice-pass-123')
LARGE_MB = 60

FOLDERS = ['Documents', 'Documents/Invoices', 'Photos', 'Projects', 'Projects/Bulwark', 'Large']
FILES = {
    'Documents/Welcome.txt': b'Welcome to the Bulwark plugin test Nextcloud.\n',
    'Documents/Report 2026.pdf': minimal_pdf(['Quarterly report 2026', 'Revenue up, costs down.']),
    'Documents/Invoices/invoice-2026-10.pdf': minimal_pdf(['Invoice 2026-10', 'Amount due: 120.00 EUR']),
    'Photos/blue.png': minimal_png(rgb=(37, 99, 235)),
    'Photos/orange.png': minimal_png(width=120, height=80, rgb=(234, 88, 12)),
    'Projects/Bulwark/notes.txt': 'Notizen mit Umlauten: äöü ß\n'.encode('utf-8'),
    'Projects/Bulwark/plan.md': b'# Plan\n\n- test the Nextcloud plugin\n',
}
SHARED_FILE = 'Documents/Report 2026.pdf'


def occ(*args, env=None, check=True):
    return docker_exec(CONTAINER, 'php', 'occ', *args, user='www-data', env=env, check=check)


def dav_url(path=''):
    return f'{BASE}/remote.php/dav/files/{USER}/' + quote(path)


def app_password_works(pw):
    r = http('PROPFIND', dav_url(), headers={'Depth': '0'}, auth=(USER, pw))
    return r.status == 207


def ensure_app_password():
    secret = read_secret('nextcloud') or {}
    pw = secret.get('appPassword')
    if pw and app_password_works(pw):
        return pw, False
    res = occ('user:auth-tokens:add', USER, env={'NC_PASS': PASSWORD}, check=False)
    if res.returncode != 0:
        # Older name of the same command.
        res = occ('user:add-app-password', USER, '--password-from-env', env={'NC_PASS': PASSWORD})
    # The command prints a few lines; the token is the last non-empty line.
    pw = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()][-1]
    if not app_password_works(pw):
        sys.exit(f'new app password does not work for WebDAV: {res.stdout}')
    return pw, True


def main():
    wait_for('Nextcloud', lambda: http('GET', f'{BASE}/status.php').json().get('installed'))

    users = json.loads(occ('user:list', '--output=json').stdout)
    if USER not in users:
        occ('user:add', '--password-from-env', '--display-name=Alice Example', USER,
            env={'OC_PASS': PASSWORD})
        print('nextcloud: created user alice')
    occ('user:setting', USER, 'settings', 'email', 'alice@example.org')
    occ('app:enable', 'files_sharing')
    occ('config:app:set', 'core', 'shareapi_allow_links', '--value=yes')

    app_pw, created = ensure_app_password()
    print('nextcloud: app password', 'created' if created else 'reused')
    auth = (USER, app_pw)

    for folder in FOLDERS:
        if http('PROPFIND', dav_url(folder), headers={'Depth': '0'}, auth=auth).status == 404:
            r = http('MKCOL', dav_url(folder), auth=auth)
            if r.status not in (201, 405):
                sys.exit(f'MKCOL {folder}: {r.status} {r.text}')
    for path, data in FILES.items():
        if http('PROPFIND', dav_url(path), headers={'Depth': '0'}, auth=auth).status == 404:
            r = http('PUT', dav_url(path), body=data, auth=auth)
            if r.status not in (201, 204):
                sys.exit(f'PUT {path}: {r.status} {r.text}')
            print('nextcloud: uploaded', path)

    # A large file for chunked-download/upload tests. Written in the container
    # and picked up with files:scan instead of pushing 60 MB over HTTP.
    large = f'Large/random-{LARGE_MB}mb.bin'
    if http('PROPFIND', dav_url(large), headers={'Depth': '0'}, auth=auth).status == 404:
        target = f'/var/www/html/data/{USER}/files/{large}'
        docker_exec(CONTAINER, 'dd', 'if=/dev/urandom', f'of={target}', 'bs=1M',
                    f'count={LARGE_MB}', 'status=none', user='www-data')
        occ('files:scan', f'--path={USER}/files/Large')
        print('nextcloud: created', large)

    ocs_headers = {'OCS-APIRequest': 'true', 'Accept': 'application/json'}
    shares_api = f'{BASE}/ocs/v2.php/apps/files_sharing/api/v1/shares'
    r = http('GET', f'{shares_api}?path={quote("/" + SHARED_FILE)}', headers=ocs_headers, auth=auth)
    links = [s for s in r.json()['ocs']['data'] if s.get('share_type') == 3]
    if links:
        share_url = links[0]['url']
    else:
        body = f'path={quote("/" + SHARED_FILE)}&shareType=3&permissions=1'
        r = http('POST', shares_api, body=body, auth=auth,
                 headers={**ocs_headers, 'Content-Type': 'application/x-www-form-urlencoded'})
        if r.status != 200:
            sys.exit(f'create share: {r.status} {r.text}')
        share_url = r.json()['ocs']['data']['url']
        print('nextcloud: created share link', share_url)

    path = write_secret('nextcloud', {
        'url': BASE,
        'webdav': f'{BASE}/remote.php/dav/files/{USER}/',
        'loginFlowV2': f'{BASE}/index.php/login/v2',
        'admin': {'user': ADMIN[0], 'password': ADMIN[1]},
        'user': USER,
        'password': PASSWORD,
        'appPassword': app_pw,
        'shareLink': share_url,
        'sharedFile': SHARED_FILE,
        'largeFile': large,
    })
    print(f'nextcloud: ok, alice app password {app_pw} (saved to {path})')


if __name__ == '__main__':
    main()
