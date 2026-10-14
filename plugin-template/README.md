# Plugin Template

Starter template for creating a Bulwark Mail plugin.

## Setup

```bash
npm install
```

## Development

Edit `src/index.js` with your plugin code.

## Build

```bash
npm run build
```

This produces `dist/index.js` using esbuild.

## Package

```bash
cp manifest.json dist/
cd dist
zip -r ../my-plugin.zip manifest.json index.js
```

Upload the ZIP via **Admin → Plugins** in Bulwark Mail.

## Customization

1. **manifest.json**: Update `id`, `name`, `author`, `description`, `type`, and `permissions`
2. **src/index.js**: Keep the slot, hooks and settings you need and remove the rest
3. **package.json**: Update `name` to match your plugin

## Drawing UI

Draw everything with the app's UI kit. It is the app's own set of controls,
so your plugin looks like the rest of Bulwark in light, dark and custom
themes:

```js
import { SidebarRow, Field, Input, DialogButtons } from '@plugin-host/ui';
```

The host provides the kit at run time, like React, so it is not bundled.
The plugin iframe has CSS for kit components only: no Tailwind classes, no
stylesheets of your own, no hard-coded colours. Lay things out with
`Stack`, `Row`, `Text` and `Heading`.

The template shows the common pieces:

- a sidebar section (`sidebar-section`): the host draws the header, titled
  with `api.ui.setSectionTitle`, and the plugin draws `SidebarRow`s,
  `SidebarEmpty` and an "add" row with a plus
- a dialog (`api.ui.openDialog` with the `plugin-dialog` slot): the body
  starts with `Field`s, and the buttons go to the host's footer through
  `DialogButtons`, Cancel first
- a host-drawn command palette entry (`api.ui.setActions`): buttons and menu
  entries on the app's surfaces are declared as data, not drawn in an iframe

Reader banners use `InfoBar`, settings use `Section` and `SettingRow`, full
pages use `Page` and `PageHeader`. Each component in the kit names the app
screen it copies.

## Tests

`test/ui.test.mjs` renders the section and the dialog with a fake api
(`test-utils/fake-api.mjs` in the plugins repo) and a stand-in for the kit.
Run it with `npx vitest run plugin-template` from the repo root.

## Plugin Types

- **`hook`** — Event-driven, no visible UI. Reacts to emails, calendar events, etc.
- **`ui-extension`** — Adds buttons, banners, or panels to existing views.
- **`sidebar-app`** — Adds a full panel in the sidebar area.

## Notes

- React is provided by the host app — do **not** bundle it
- Use `api.storage` for persistent data, not `localStorage` directly
- Every hook and slot needs its permission in `manifest.json` (for example `email:read` for `onEmailOpen`, `ui:sidebar-widget` for the sidebar widget), or the host skips it
- Put strings users see in `locales` in `manifest.json` and read them with `api.i18n.t()`
- Plugin auto-disables after 3 errors in 60 seconds
