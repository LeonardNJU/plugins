# Impersonation Notice

Persistent top-of-app banner shown while a Stalwart master-user impersonation session is active. Pairs with Bulwark's built-in `/api/auth/impersonate` JWT route (Bulwark ≥ 1.6.7).

## What it does

When the active session username contains `%` (Stalwart's master-user syntax `<target>%<master>`), the plugin renders a strip across the very top of the app, above the navigation rail, sidebar and content, showing the mailbox being viewed and an optional "Back to platform" button.

Detection is automatic; admins only configure styling and the platform return URL.

## How a platform hands users in

```
GET https://webmail.example.com/api/auth/impersonate?token=<HS256 JWT>
```

The server-side route (built into Bulwark) verifies the JWT, mints session cookies for `target%master`, and 303-redirects to `/`. The plugin then surfaces the impersonation status to the user.

The cryptographic configuration (signing secret, master credentials) lives in the Bulwark process environment, not in admin config. See the "Server-side configuration" section of the plugin admin page.

## Admin settings

| Key                | Default             | Notes                                                                                  |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------- |
| `returnUrl`        | _empty_             | Opened in a new tab by "Back to platform", which also signs out of the impersonated session. Empty hides the button. |
| `returnLabel`      | `Back to platform`  | Button label.                                                                          |
| `bannerBackground` | `#3b82f6`           | Strip background colour in light mode.                                                 |
| `bannerBackgroundDark` | `#1e40af`       | Strip background colour in dark mode.                                                  |
| `bannerForeground` | `#ffffff`           | Strip text colour.                                                                     |
| `actorRoleLabel`   | `as Platform Admin` | Suffix appended to the mailbox in the banner copy.                                     |

All settings are organisation-wide (`api.admin.setConfig`). Per-user override is intentionally not exposed.

## Permissions

- `account:read` — receive the session username (the banner slot's `username` prop) to detect `%`
- `auth:emit` — sign out when "Back to platform" is clicked
- `ui:app-top-banner` — render the strip
- `ui:admin-page` — configuration UI
- `admin:config` — read/write org-wide settings

## Building

```sh
npm install
npm run build
```

Outputs `dist/index.js`. Zip the manifest, the `dist/` folder, and the optional `media/` folder for distribution.
