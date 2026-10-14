"""Shared helpers for the seed scripts (Python 3 standard library only)."""
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEST_ENV = HERE.parent
SECRETS = TEST_ENV / '.secrets'


class HttpResult:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers
        self.body = body

    def json(self):
        return json.loads(self.body.decode('utf-8'))

    @property
    def text(self):
        return self.body.decode('utf-8', 'replace')


def http(method, url, body=None, headers=None, auth=None, timeout=60):
    """Do one request and return HttpResult, also for 4xx/5xx answers."""
    headers = dict(headers or {})
    if auth is not None:
        token = base64.b64encode(f'{auth[0]}:{auth[1]}'.encode()).decode()
        headers['Authorization'] = f'Basic {token}'
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
        headers.setdefault('Content-Type', 'application/json')
    elif isinstance(body, str):
        body = body.encode()
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return HttpResult(resp.status, resp.headers, resp.read())
    except urllib.error.HTTPError as err:
        return HttpResult(err.code, err.headers, err.read())


def wait_for(name, check, timeout=600, interval=3):
    """Poll check() until it returns truthy; exit with an error on timeout."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            if check():
                return
        except Exception as exc:  # connection refused while starting, etc.
            last = exc
        time.sleep(interval)
    sys.exit(f'{name} did not become ready in {timeout}s (last error: {last})')


def docker_exec(container, *args, user=None, env=None, check=True, stdin=None):
    cmd = ['docker', 'exec']
    if stdin is not None:
        cmd.append('-i')
    if user:
        cmd += ['-u', user]
    for k, v in (env or {}).items():
        cmd += ['-e', f'{k}={v}']
    cmd.append(container)
    cmd += list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', input=stdin)
    if check and res.returncode != 0:
        sys.exit(f'command failed ({res.returncode}): {" ".join(cmd)}\n{res.stdout}\n{res.stderr}')
    return res


def read_secret(name):
    path = SECRETS / f'{name}.json'
    if path.exists():
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except ValueError:
            return None
    return None


def write_secret(name, data):
    SECRETS.mkdir(exist_ok=True)
    path = SECRETS / f'{name}.json'
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    return path


def minimal_pdf(lines):
    """Build a small, valid one-page PDF with the given text lines."""
    def esc(s):
        return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    ops = ['BT', '/F1 14 Tf', '72 760 Td', '18 TL']
    for line in lines:
        ops.append(f'({esc(line)}) Tj T*')
    ops.append('ET')
    stream = '\n'.join(ops).encode('latin-1')
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
        b'/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
    ]
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for i, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for off in offsets:
        out += f'{off:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)


def minimal_png(width=64, height=64, rgb=(37, 99, 235)):
    """Build a solid-colour PNG."""
    import struct
    import zlib

    def chunk(kind, data):
        c = struct.pack('>I', len(data)) + kind + data
        return c + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    row = b'\x00' + bytes(rgb) * width
    raw = row * height
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
