"""Seed the test Vikunja: user alice, an API token and a project with a task.

    python seed/seed_vikunja.py

Idempotent: registration is skipped when alice can log in, the API token in
.secrets/vikunja.json is reused while it works, and the project and task are
looked up by title.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import http, read_secret, wait_for, write_secret  # noqa: E402

BASE = os.environ.get('VIKUNJA_URL', 'http://localhost:18456')
API = BASE + '/api/v1'
USER = 'alice'
EMAIL = 'alice@example.org'
PASSWORD = os.environ.get('VIKUNJA_ALICE_PASSWORD', 'alice-pass-123')
PROJECT = 'Bulwark inbox'
TASK = 'Reply to Carol about Thursday'


def bearer(token):
    return {'Authorization': f'Bearer {token}'}


def login():
    r = http('POST', f'{API}/login', body={'username': USER, 'password': PASSWORD, 'long_token': True})
    return r.json()['token'] if r.status == 200 else None


def main():
    wait_for('Vikunja', lambda: http('GET', f'{API}/info').status == 200)

    jwt = login()
    if not jwt:
        r = http('POST', f'{API}/register', body={'username': USER, 'email': EMAIL, 'password': PASSWORD})
        if r.status not in (200, 201):
            sys.exit(f'vikunja register: {r.status} {r.text}')
        print('vikunja: registered alice')
        jwt = login()
        if not jwt:
            sys.exit('vikunja: cannot log in after registering')

    secret = read_secret('vikunja') or {}
    token = secret.get('token')
    if not token or http('GET', f'{API}/projects', headers=bearer(token)).status != 200:
        # Grant every permission the server offers, so tests are not limited
        # by the token. /routes lists them per group.
        routes = http('GET', f'{API}/routes', headers=bearer(jwt)).json()
        permissions = {group: sorted(perms.keys()) for group, perms in routes.items()}
        r = http('PUT', f'{API}/tokens', headers=bearer(jwt), body={
            'title': 'bulwark-plugin-tests',
            'expires_at': '2099-12-31T23:59:59Z',
            'permissions': permissions,
        })
        if r.status not in (200, 201):
            sys.exit(f'vikunja token: {r.status} {r.text}')
        token = r.json()['token']
        print('vikunja: created API token')

    projects = http('GET', f'{API}/projects', headers=bearer(token)).json()
    project = next((p for p in projects if p['title'] == PROJECT), None)
    if not project:
        r = http('PUT', f'{API}/projects', headers=bearer(token),
                 body={'title': PROJECT, 'description': 'Tasks created from mail'})
        if r.status not in (200, 201):
            sys.exit(f'vikunja project: {r.status} {r.text}')
        project = r.json()
        print('vikunja: created project', PROJECT)

    tasks = http('GET', f'{API}/projects/{project["id"]}/tasks', headers=bearer(token))
    if tasks.status != 200:
        sys.exit(f'vikunja list tasks: {tasks.status} {tasks.text}')
    if not any(t['title'] == TASK for t in tasks.json()):
        r = http('PUT', f'{API}/projects/{project["id"]}/tasks', headers=bearer(token),
                 body={'title': TASK, 'description': 'Seeded task', 'due_date': '2026-10-22T15:00:00Z'})
        if r.status not in (200, 201):
            sys.exit(f'vikunja task: {r.status} {r.text}')
        print('vikunja: created task', TASK)

    path = write_secret('vikunja', {
        'url': BASE,
        'api': API,
        'user': USER,
        'email': EMAIL,
        'password': PASSWORD,
        'token': token,
        'projectId': project['id'],
        'project': PROJECT,
    })
    print(f'vikunja: ok, project {project["id"]}, token {token} (saved to {path})')


if __name__ == '__main__':
    main()
