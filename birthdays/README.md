# Birthday reminders

Shows upcoming birthdays from your contacts in the mail sidebar, reminds you
of them and opens a birthday greeting with one click.

## What it does

- **Sidebar widget.** Lists the birthdays of the next 30 days (setting), soonest
  first: "Today · October 14 · turns 36". It reads every address book of your
  account, refreshes every 10 minutes and when you come back to the tab. Five
  rows are shown, the rest behind "Show all".
- **Reminders.** A notification on the day ("It's Ada's birthday today") and
  one when the birthday comes within 3 days (setting; "Ben's birthday is in 2
  days"). Each contact gets at most one reminder a day, and the early one only
  once per birthday, also with several tabs open. More than three at once are
  summed up in one notification ("Birthdays today: Ada, Ben, ..."). It is a
  system notification when you allowed them for the webmail, otherwise a toast.
  Reminders are checked when the webmail starts, when the day changes, every
  hour and a few seconds after you change a contact, so the webmail has to be
  open for them; the plugin can't remind you while it is closed.
- **Send greeting.** Each contact with an email address gets a "Send greeting"
  button in the widget. It opens the composer addressed to them, with "Happy
  birthday, Ada!" as subject and a short line to start from, in your language.
  Nothing is sent until you press Send. Clicking a system notification for one
  contact does the same; a summary notification just brings the webmail to the
  front.

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
| Birthday reminders | on | Notifications on the day and a few days before. |
| Remind me … days before | 3 | When the early reminder comes (0-30). 0 leaves only the one on the day. |

## Permissions

| Permission | Why |
| --- | --- |
| `contacts:read` | Read the birthdays of your contacts. |
| `ui:sidebar-widget` | Show the list in the mail sidebar. |
| `ui:notifications` | Show the reminders. |
| `compose:open` | Open the composer for a greeting. |

The plugin also uses the app lifecycle hooks (start, once a minute), which
every plugin has.

## Privacy

The plugin sends nothing anywhere. It reads your contacts through the webmail
and keeps no copy of them; the only thing it stores (in this browser) is which
reminders it has shown, by contact id and date.

## Development

```
node scripts/build.mjs birthdays
node node_modules/vitest/vitest.mjs run birthdays
```
