# S/MIME test fixtures

A throwaway self-signed RSA-2048 key for smime-test@example.com, and messages
encrypted to it. Nothing here protects anything.

- `cert.pem`, `test.p12`: the certificate, and certificate + key with the
  password `fixture`
- `plain.eml`: the message all of them encrypt
- `cbc.p7m`: EnvelopedData, AES-256-CBC, key wrapped with RSA PKCS#1 v1.5
  (what Thunderbird, Outlook and Stalwart's AES-CBC encryption at rest write)
- `gcm.p7m`: AuthEnvelopedData, AES-256-GCM, key wrapped with RSA-OAEP
  SHA-256 (Stalwart's AES-256-GCM encryption at rest)

OpenSSL can't write ChaCha20-Poly1305 CMS, so the test builds that one.

To make new ones (Git Bash on Windows needs `MSYS_NO_PATHCONV=1` for `-subj`):

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 36500 \
  -subj "/CN=S-MIME Test/emailAddress=smime-test@example.com" \
  -addext "subjectAltName=email:smime-test@example.com" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=emailProtection"
openssl pkcs12 -export -in cert.pem -inkey key.pem -out test.p12 -passout pass:fixture -name "S-MIME Test"
printf 'Content-Type: text/plain; charset=utf-8\r\n\r\nHello from the S/MIME test fixture.\r\n' > plain.eml
openssl cms -encrypt -binary -aes256 -in plain.eml -out cbc.p7m cert.pem
openssl cms -encrypt -binary -aes-256-gcm -in plain.eml -out gcm.p7m -recip cert.pem \
  -keyopt rsa_padding_mode:oaep -keyopt rsa_oaep_md:sha256 -keyopt rsa_mgf1_md:sha256
rm key.pem
```
