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

The settings fields themselves are labelled in English: the webmail shows a
plugin's setting labels as written in its manifest.

## Permissions

| Permission | Why |
| --- | --- |
| `ui:settings-section` | The section on the plugin's settings page. |

## Data

Everything stays in your browser. The time zones you set for people are kept
in the plugin's storage for the signed-in account. Nothing is sent anywhere.
