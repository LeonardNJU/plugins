# Auto Tag Plugin

Automatically tags incoming emails based on configurable rules. Recognizes newsletters, invoices, and GitHub notifications out of the box.

## Features

- **Newsletter detection** — Tags emails with a List-Unsubscribe header, from `noreply@` addresses or with unsubscribe-related subjects
- **Invoice detection** — Tags emails with invoice/receipt/billing keywords in the subject
- **GitHub detection** — Tags emails from GitHub notification addresses
- All rules are toggleable via plugin settings
- The first matching rule adds its keyword (`$github`, `$newsletter` or `$invoice`) to the message

## Demonstrates

- `hooks.onNewEmailReceived` — reacting to incoming email
- `api.email.setKeyword()` — tagging a message (needs `email:write`)
- `api.plugin.settings` and `api.plugin.onSettingsChange()` — user-configurable boolean settings
- `api.storage` — persisting counters across sessions
- Pattern matching on the sender list, subject and headers

## Build & Install

```bash
npm install
npm run build
cp manifest.json dist/
cd dist && zip -r ../auto-tag.zip manifest.json index.js
```

Upload `auto-tag.zip` via Admin → Plugins.
