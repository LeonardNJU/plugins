"""Send one test message to alice over Stalwart's SMTP submission port.

    python send_mail.py < message.json

The JSON has from, subject, text and html. Logs in as bob (alice's own
JMAP and upload limits are shared with every other suite), envelope to
alice. Prints the Message-ID.
"""
import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

HOST = os.environ.get('SMTP_HOST', 'localhost')
PORT = int(os.environ.get('SMTP_PORT', '11587'))
LOGIN = os.environ.get('SMTP_LOGIN', 'bob@example.org')
PASSWORD = os.environ.get('SMTP_PASSWORD', 'test-pass-123')
TO = os.environ.get('BULWARK_USER', 'alice@example.org')


def main():
    data = json.load(sys.stdin)
    msg = EmailMessage()
    msg['From'] = data['from']
    msg['To'] = TO
    msg['Subject'] = data['subject']
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain='example.org')
    msg.set_content(data['text'])
    msg.add_alternative(data['html'], subtype='html')
    with smtplib.SMTP(HOST, PORT, timeout=30) as smtp:
        smtp.ehlo()
        if smtp.has_extn('starttls'):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            smtp.starttls(context=ctx)
            smtp.ehlo()
        smtp.login(LOGIN, PASSWORD)
        smtp.send_message(msg, from_addr=LOGIN, to_addrs=[TO])
    print(msg['Message-ID'])


if __name__ == '__main__':
    main()
