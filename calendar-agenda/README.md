# Calendar Agenda Plugin

A sidebar section that shows an agenda of your **upcoming calendar events**, each with when it starts (Today 14:00, Tomorrow 09:30, Wed, Oct 16). A companion to the Quick Notes plugin, sharing its slot-iframe and background-hook architecture.

## Features

- **Sidebar agenda** — Upcoming events for the next _N_ days as sidebar rows, with the start time where a folder shows its count and the location in the tooltip.
- **Recurring events** — Recurring series are expanded server-side, so the right occurrences show up.
- **Live updates** — Refreshes on a timer, on focus, and immediately whenever you create/update/delete an event.
- **Looks like the app** — Drawn with the app's UI kit (sidebar rows, list rows, info bar), so it follows light, dark and custom themes.
- **Credentials stay server-side** — The plugin only ever sees slim event DTOs.

## How it works

The widget calls the host sidecar route `POST /api/calendar-agenda`, which:

1. Resolves the caller's calendar account from the stored Stalwart auth context (JMAP session).
2. Runs `CalendarEvent/query` + `CalendarEvent/get` over JMAP for events up to the horizon.
3. Normalizes and expands recurring series (reusing the app's own calendar helpers).
4. Returns a slim, sorted agenda: `{ id, title, start, end, allDay, status, color, location, calendarId }`.

The background hooks (`onAfterEventCreate`, `onAfterEventUpdate`, `onAfterEventDelete`, `onEventsImport`, `onEventRsvp`, `onCalendarChange`, `onICalSubscriptionChange`) bump a `agendaDirty` marker in plugin storage; the widget watches it and refetches promptly.

> The sidecar route lives in the main app at `app/api/calendar-agenda/route.ts`. If you run a custom build without it, the widget shows a friendly error instead of crashing.

## Demonstrates

- `api.http.post()` — calling a same-origin host sidecar (allow-listed via `apiPostPaths`)
- `slots['sidebar-section']` with `api.ui.setSectionTitle()` — the host draws the section header and folding
- `@plugin-host/ui` — `SidebarRow`, `ListRow`, `InfoBar` and `Chip` from the app's UI kit
- `api.hooks.onAfter*` calendar hooks — reacting to data changes from the background iframe
- `api.storage` — cross-iframe coordination via a dirty marker
- `api.plugin.settings` — number settings
- React `useState`, `useEffect`, `useCallback`, `useRef` without JSX

## Settings

| Setting          | Default        | Description                                                                 |
| ---------------- | -------------- | --------------------------------------------------------------------------- |
| `position`       | `Left sidebar` | Where the widget renders: **Left sidebar**, **Email reading pane**, or **Top banner** |
| `daysAhead`      | 7              | How many days of upcoming events to include                                 |
| `maxEvents`      | 50             | Cap on how many events are shown                                            |
| `refreshMinutes` | 10             | Background auto-refresh interval (also refreshes on edit)                   |

### Position

The agenda can live in one of three slots: `sidebar-section` (left sidebar, a section below the folders), `email-detail-sidebar` (beside an open email), or `app-top-banner` (top of the app). At load time the plugin reads the `position` setting and registers **only** the matching slot, so the other locations reserve no space. Changing the position requires reloading the plugin (re-enable it from Admin → Plugins) so it re-registers against the new slot.

## Build & Install

```bash
npm install
npm run build
cp manifest.json dist/
cd dist && zip -r ../calendar-agenda.zip manifest.json index.js
```

Upload `calendar-agenda.zip` via Admin → Plugins.
