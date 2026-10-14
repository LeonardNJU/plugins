# Email Stats Plugin

A sidebar section that tracks email activity.

## Features

- Counts emails opened, sent, and received in the current session
- Persists lifetime totals across sessions using plugin storage
- Configurable via settings (toggle tracking of opens and sends)
- Counters as sidebar rows, the number where a folder shows its count

## Demonstrates

- `slots['sidebar-section']` — a section in the mail sidebar; the host draws its header
- `@plugin-host/ui` — `SidebarRow` and `SidebarEmpty` from the app's UI kit
- `api.hooks.onEmailOpen()` — tracking email opens
- `api.hooks.onAfterEmailSend()` — tracking sent emails
- `api.hooks.onNewEmailReceived()` — tracking incoming emails
- `api.storage` — persistent data across sessions
- `api.plugin.settings` — reading user-configured settings
- React `useState` + `useEffect` without JSX

## Build & Install

```bash
npm install
npm run build
cp manifest.json dist/
cd dist && zip -r ../email-stats.zip manifest.json index.js
```

Upload `email-stats.zip` via Admin → Plugins.
