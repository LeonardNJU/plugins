# Quick Notes Plugin

Per-email sticky notes in the sidebar. Jot down notes while reading emails and see them again when you revisit.

## Features

- **Side panel** — A note field beside the open message, one note per email
- **Email banner** — A one-line info bar above emails that have a note
- **Persistent storage** — Notes survive page reloads and sessions
- **Auto-cleanup** — Oldest notes removed when storage limit reached
- **Looks like the app** — Drawn with the app's UI kit, so it follows light, dark and custom themes

## Demonstrates

- `slots['email-detail-sidebar']` — a panel next to the open message
- `slots['email-banner']` — conditional banner with a `shouldShow` predicate
- `api.hooks.onEmailOpen()` / `onEmailClose()` — tracking the active email
- `api.storage` — persisting structured data (notes object)
- `api.plugin.settings` — number and boolean settings
- React `useState`, `useEffect`, `useCallback` without JSX
- `@plugin-host/ui` — `InfoBar`, `Field`, `Textarea` and `Heading` from the app's UI kit

## Build & Install

```bash
npm install
npm run build
cp manifest.json dist/
cd dist && zip -r ../quick-notes.zip manifest.json index.js
```

Upload `quick-notes.zip` via Admin → Plugins.
