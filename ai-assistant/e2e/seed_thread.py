"""Put a three-message conversation into alice's inbox for the conversation
summary test. Idempotent: does nothing when the subject is already there.

    python seed_thread.py   (test-env must be running)
"""
import smtplib
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'test-env' / 'seed'))
from seed_mail import existing_subjects  # noqa: E402

USER = 'alice@example.org'
PASSWORD = 'test-pass-123'
SUBJECT = 'Team offsite in November'


def main():
    if f'Re: {SUBJECT}' in existing_subjects('http://localhost:18025', USER, PASSWORD):
        print('thread: already there')
        return
    msgs = []
    first_id = make_msgid(domain='example.org')
    bodies = [
        ('Bob <bob@example.org>', SUBJECT, 'Hi all,\n\nshall we do the offsite on 12 November in Hamburg? Budget is 2000 EUR.\n\nBob'),
        ('Carol <carol@example.org>', f'Re: {SUBJECT}', 'Hamburg works for me, but 12 November clashes with a customer visit. Could we do 19 November?\n\nCarol'),
        ('Bob <bob@example.org>', f'Re: {SUBJECT}', 'OK, 19 November then. Alice, can you book the room by Friday?\n\nBob'),
    ]
    refs = []
    for i, (sender, subject, body) in enumerate(bodies):
        msg = EmailMessage()
        msg['From'] = sender
        msg['To'] = USER
        msg['Subject'] = subject
        msg['Date'] = formatdate(localtime=True)
        msg['Message-ID'] = first_id if i == 0 else make_msgid(domain='example.org')
        if refs:
            msg['In-Reply-To'] = refs[-1]
            msg['References'] = ' '.join(refs)
        refs.append(msg['Message-ID'])
        msg.set_content(body)
        msgs.append(msg)
    with smtplib.SMTP('localhost', 11587, timeout=30) as smtp:
        smtp.ehlo()
        if smtp.has_extn('starttls'):
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            smtp.starttls(context=ctx)
            smtp.ehlo()
        smtp.login(USER, PASSWORD)
        for msg in msgs:
            smtp.send_message(msg, from_addr=USER, to_addrs=[USER])
    print('thread: sent')


if __name__ == '__main__':
    main()
