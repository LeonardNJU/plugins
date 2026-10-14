# Birthday reminders

Shows upcoming birthdays from your contacts in the mail sidebar.

## What it does

- **Sidebar widget.** Lists the birthdays of the next 30 days (setting), soonest
  first: "Today · October 14 · turns 36". It reads every address book of your
  account, refreshes every 10 minutes and when you come back to the tab. Five
  rows are shown, the rest behind "Show all".

## Dates

- A birthday without a year is shown without an age.
- **February 29**: in years without that day the birthday is celebrated on
  **February 28**, the day before the date would roll over to March.
- Dates are read from the contact's birthday (`anniversaries` with kind
  `birth`), as JSContact partial dates, `--MM-DD` or `YYYY-MM-DD`. Wedding and
  other anniversaries are ignored, as are contact groups.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Show birthdays in the next … days | 30 | How far ahead the sidebar list looks (1-365). |

## Permissions

| Permission | Why |
| --- | --- |
| `contacts:read` | Read the birthdays of your contacts. |
| `ui:sidebar-widget` | Show the list in the mail sidebar. |

## Privacy

The plugin sends nothing anywhere. It reads your contacts through the webmail
and keeps no copy of them.

## Development

```
node scripts/build.mjs birthdays
node node_modules/vitest/vitest.mjs run birthdays
```
