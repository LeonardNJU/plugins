# Time zone helper

Shows the time where the people you write to are.

## Settings

Under Settings → Plugins → Time zone helper:

- **Favourite time zones**: cities or zones separated by commas, for example
  `Berlin, New York, Asia/Tokyo`. City names, IANA zone ids in any case and a
  few common aliases (Munich, San Francisco, Mumbai) are understood.
- **Your time zone**: leave it empty to use your browser's zone. Set it when
  you picked another time zone in the webmail's own settings (plugins can't
  read that setting).

The plugin also gets its own page in Settings (**Time zone helper** under
Apps). It shows how your favourites were understood, points out entries it
didn't recognise, and lists the time zones you set for people (by email
address), where you can add or remove them.

![Settings page](screenshots/settings-light.png)
![Settings page, dark](screenshots/settings-dark.png)

The settings fields are labelled in the user's language: their labels are
keys of the plugin's own translations.

## Event form

The form for a new or edited event gets a **Time zones** section. It shows
the event's time for every participant whose time zone you set, and in each
of your favourite zones, with "next day" or "previous day" when the date
differs. Participants without a zone are listed with a **Set** link, so you
can pick their zone right there; it is remembered for that address.

When the event falls outside working hours (08:00 to 20:00 by default, see
**Working hours start** and **Working hours end** in the settings) for a
participant, the form shows a warning next to its other warnings, for
example "Outside 08:00–20:00 for kei@example.jp (Tokyo)". Favourite zones are
only marked, not warned about. The warning appears when the times change
(the form re-checks then); all-day events get none.

The section reads the event's own time zone. The warning is worked out from
the times in the form and your time zone setting (or your browser's).

![Event form](screenshots/event-form-light.png)
![Event form, dark](screenshots/event-form-dark.png)

## Reading mail

A message's Date header keeps the UTC offset the sender's computer used.
When it differs from yours, a line under the sender says when they wrote it
on their own clock, for example "Sent 11:40 PM their time (UTC−5)". In the
message details (Show details), a **Their time** row under Recipients &
routing shows the same, and lets you set the sender's time zone. Once it is
set, both places add the time it is there now.

The offset only says where the sender's clock was when they sent the
message, not which zone they are in, so the plugin never guesses a zone from
it. Headers with an unknown zone (`-0000`) show nothing.

![Reader](screenshots/reader-light.png)
![Reader, dark](screenshots/reader-dark.png)

## Composer

The composer's plugin row gets a **Time zones** button. It opens a dialog
where you pick a date and a time (in your zone) and the zones to show; your
zone and your favourites are ticked, and you can add others. It writes one
line such as `3:00 PM Berlin / 9:00 AM New York` (with weekdays when the
zones are on different dates). **Insert** puts it where the cursor is in the
message (replacing selected text); **Copy** puts it on the clipboard
instead. Where the browser doesn't let the plugin frame copy, the dialog
selects the text and asks you to press Ctrl+C.

![Composer](screenshots/composer-light.png)
![Composer, dark](screenshots/composer-dark.png)

## World clock

Off by default. Turn on **World clock in the sidebar** in the settings and
reload the page: a section in the mail sidebar then shows the time now in
your zone and each favourite zone, with the UTC offset and "+1" or "−1"
when that zone is already on another day. Zones outside working hours are
dimmed. The time updates every 30 seconds.

![World clock](screenshots/world-clock-light.png)
![World clock, dark](screenshots/world-clock-dark.png)

## Permissions

| Permission | Why |
| --- | --- |
| `ui:settings-section` | The plugin's page in Settings. |
| `ui:calendar-action` | The section in the event form. |
| `ui:email-banner` | The line under the sender of the open message. |
| `ui:email-details` | The row in the message details. |
| `email:read` | To read the open message's Date header and sender address. Nothing else of the message is used. |
| `ui:composer-toolbar` | The button in the composer. The dialog it opens needs no permission of its own. |
| `compose:open` | To insert the line into the message (the composer's insertText). The plugin never opens a composer by itself. |
| `ui:sidebar-widget` | The world clock section in the mail sidebar (only offered when it is turned on). |
| `calendar:read` | To see the event in the form (times, participants) and add the working-hours warning (onCheckEventConflicts). |

## Data

Everything stays in your browser. The time zones you set for people are kept
in the plugin's storage for the signed-in account. Nothing is sent anywhere.
