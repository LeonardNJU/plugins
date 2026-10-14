"""Send a set of test messages to the test Stalwart over SMTP submission.

    python seed/seed_mail.py [--host localhost] [--port 11587]

Idempotent: subjects already in the mailbox (checked over JMAP) are not sent
again.

Messages are built to exercise the plugins: an attachment, an invitation-like
mail, a shipping notice with tracking numbers, a newsletter with
List-Unsubscribe, and a German mail with a +02:00 Date header.
"""
import argparse
import base64
import json
import smtplib
import urllib.request
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

HERE = Path(__file__).parent
FIXTURES = HERE / 'fixtures'


def message(sender, to, subject, body, date=None, headers=None, attachments=()):
    msg = EmailMessage()
    msg['From'] = sender
    msg['To'] = to
    msg['Subject'] = subject
    msg['Date'] = date or formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain='example.org')
    for k, v in (headers or {}).items():
        msg[k] = v
    msg.set_content(body)
    for name, data, maintype, subtype in attachments:
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return msg


def fixture_bytes(name, fallback):
    path = FIXTURES / name
    return path.read_bytes() if path.exists() else fallback


def build(user):
    pdf = fixture_bytes('invoice.pdf', b'%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
    return [
        message('Bob <bob@example.org>', user, 'Invoice 2026-10 attached',
                'Hi,\n\nplease find the October invoice attached.\n\nBob',
                attachments=[('invoice-2026-10.pdf', pdf, 'application', 'pdf')]),
        message('Carol <carol@example.org>', user, 'Can we meet on Thursday?',
                'Hi,\n\ncould we meet Thursday at 15:00 to go through the draft? '
                'Please send me the slides by Wednesday.\n\nCarol'),
        message('Shop <orders@shop.example>', user, 'Your order has shipped',
                'Your parcel is on its way.\n\nDHL tracking number: 00340434161094042557\n'
                'UPS: 1Z999AA10123456784\n\nThanks for your order.'),
        message('Newsletter <news@lists.example>', user, 'October newsletter',
                'Monthly news. Unsubscribe any time.',
                headers={'List-Unsubscribe': '<mailto:unsubscribe@lists.example>'}),
        message('Jana Becker <jana@example.de>', user, 'Rückfrage zum Angebot',
                'Hallo,\n\nkurze Rückfrage zu Ihrem Angebot vom Montag.\n\nViele Grüße\nJana',
                date='Tue, 13 Oct 2026 09:30:00 +0200'),
    ]


def existing_subjects(jmap_base, user, password):
    """Subjects of the messages already in the account, via JMAP."""
    auth = 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode()

    def call(url, body=None):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                     headers={'Authorization': auth, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    session = call(f'{jmap_base}/jmap/session')
    account = session['primaryAccounts']['urn:ietf:params:jmap:mail']
    using = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail']
    # The session's apiUrl carries the server's public hostname, so post to
    # the base we were given instead.
    res = call(f'{jmap_base}/jmap/', {'using': using, 'methodCalls': [
        ['Email/query', {'accountId': account, 'limit': 1000}, 'q'],
        ['Email/get', {'accountId': account, 'properties': ['subject'],
                       '#ids': {'resultOf': 'q', 'name': 'Email/query', 'path': '/ids'}}, 'g'],
    ]})
    return {e.get('subject') for e in res['methodResponses'][1][1]['list']}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='localhost')
    ap.add_argument('--port', type=int, default=11587)
    ap.add_argument('--user', default='alice@example.org')
    ap.add_argument('--password', default='test-pass-123')
    ap.add_argument('--jmap', default='http://localhost:18025', help='Stalwart HTTP base URL')
    args = ap.parse_args()
    have = existing_subjects(args.jmap, args.user, args.password)
    todo = [m for m in build(args.user) if m['Subject'] not in have]
    if not todo:
        print('mail: all seed messages already present')
        return
    with smtplib.SMTP(args.host, args.port, timeout=30) as smtp:
        smtp.ehlo()
        if smtp.has_extn('starttls'):
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            smtp.starttls(context=ctx)
            smtp.ehlo()
        smtp.login(args.user, args.password)
        for msg in todo:
            # The test server lets an authenticated user submit with any From;
            # the envelope sender stays the login.
            smtp.send_message(msg, from_addr=args.user, to_addrs=[args.user])
            print('mail: sent', msg['Subject'])


if __name__ == '__main__':
    main()
