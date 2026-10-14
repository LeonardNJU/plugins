# External Link Warning

Intercepts clicks on external links and asks the user to confirm before
navigating to a domain that isn't on the trusted list.

## Trusted-domain sources

The plugin merges three sources (de-duplicated):

1. **Admin-managed list** — written to plugin admin config under
   `trustedDomains`. Set via:
   ```
   PUT /api/admin/plugins/external-link-warning/config
   { "key": "trustedDomains", "value": "example.com, github.com" }
   ```
   Accepts a comma/newline-separated string or a JSON array.
2. **Per-user list** — `Trusted domains` field in the plugin's settings panel.
3. **Local "Always trust" choices** — stored in plugin storage on the
   user's device. After you click Continue on an unknown domain, a second
   dialog asks whether to always trust it. Continue alone opens the link
   once; only the "Always trust" button remembers the domain. Turn the
   `Offer "Always trust"` setting off to skip that question.

Subdomains are matched automatically: trusting `example.com` also trusts
`docs.example.com`.

## Permissions

- `admin:config` — read the admin-managed trusted list.
- `ui:observe` (implicit) — required by `onBeforeExternalLink`.

## Hooks used

- `onBeforeExternalLink` — intercept hook, returns `false` to cancel the
  native navigation; the plugin opens the link with
  `api.ui.openExternalUrl` after the user confirms.

## Build & install

```bash
npm install
npm run build
cp manifest.json dist/
cd dist && zip -r ../external-link-warning.zip manifest.json index.js
```

Upload `external-link-warning.zip` via Admin -> Plugins.

## Notes

- The hook does not wait for the dialog: it cancels the navigation
  immediately and opens the URL itself after confirmation, so a hook
  timeout can never open the link while the user is still deciding.
- The dialogs are the host's `api.ui.confirm`, so the plugin has no
  runtime dependencies and the bundle stays tiny.
- Dialog and toast text is translated through `locales` in the manifest
  (English and German).
