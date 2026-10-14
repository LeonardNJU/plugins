# AI Writing Assistant

Write, rewrite, translate and proofread emails, and summarise messages and
conversations, with an OpenAI-compatible service (OpenAI, Ollama, LM
Studio, vLLM, ...) or the Anthropic Messages API.

Nothing is sent to the AI service until the user clicks one of the
assistant's buttons. Before the first request to a service the user sees
which service it is, which server the text goes to and which model
answers, and has to confirm.

## What it does

In the composer, the **Assistant** button (in the composer's plugin row,
also on phones) opens the writing assistant. It starts with the user's
own text from the draft, without the quoted message of a reply and
without the signature. From there:

- **Write**: describe the email ("thank Anna and propose Tuesday at 10")
  and get a text.
- **Rewrite**: shorter, longer, more formal, friendlier, or fix the tone.
- **Translate** into one of 32 languages (the last one used is remembered).
- **Check spelling and grammar**: each correction is shown in the text,
  crossed out and replaced, and is accepted (✓) or kept as written (✕)
  one by one, or all at once.

Answers can be stopped while they run. **Use this** puts an answer into
the working text; **Undo** takes back the last change, including single
grammar corrections. **Copy and close** copies the text, to paste into the
message.

The webmail has no way yet for a plugin to change the text in the open
composer, so the result is copied instead of inserted. When that arrives,
Use this can write into the message directly.

Above an open message, a small bar offers:

- **Summarize**: two to four points, in the user's language.
- **To-dos and dates**: action items with due dates, and deadlines and
  appointments, as two lists. **Copy list** copies them as a checklist.
  Plugins can't call each other yet, so with the Email to task plugin the
  user makes a task from the message with its own button.
- **Reply ideas**: three short replies in the language of the message;
  **Copy** one, then click Reply and paste.

Above a conversation, **Summarize this conversation** summarises up to the
last 20 messages. The bar can be hidden in the plugin's settings.

Mail text is put between tags and the model is told that it is data, not
instructions, so a message that says "ignore your instructions" is
summarised, not obeyed. Very long texts are cut at 30 000 characters.

## Setting it up (administrator)

Install `ai-assistant.zip` in the admin dashboard, then fill in its
settings. Set up one or both services:

| Setting | What to enter |
| --- | --- |
| OpenAI-compatible API address | Up to and including `/v1`: `https://api.openai.com/v1`, or `http://ollama:11434/v1` for Ollama |
| OpenAI-compatible API key | The key. Ollama needs none, but the field must not be empty: enter any text |
| OpenAI-compatible model | e.g. `gpt-4o-mini`, or `qwen2.5:7b` on Ollama |
| Anthropic API address | `https://api.anthropic.com/v1` (Ollama also speaks this API at `http://ollama:11434/v1`) |
| Anthropic API key | The key |
| Anthropic model | e.g. `claude-haiku-4-5` |
| Default service | Which one users get when both are set up |
| Let users connect their own API key | Off by default |

Without a model the defaults are `gpt-4o-mini` and `claude-haiku-4-5`.

The keys stay on the webmail server. The plugin asks the webmail's server
proxy to send each request "with the OpenAI key" or "with the Anthropic
key", and the server adds the key and only sends it to the address above.

An address on your own network (Ollama on the same host, say) is only
reachable when its origin is listed in `PLUGIN_PROXY_PRIVATE_ORIGINS` on
the webmail server, e.g. `PLUGIN_PROXY_PRIVATE_ORIGINS=http://ollama:11434`.

## Settings (users)

Settings > AI Writing Assistant shows which service and model are used. A
user can pick another model, choose between the two services when both
are set up, and hide the assistant bar above messages. When the
administrator allows it, a user can connect their own key: they pick the
service and address here, and type the key into the webmail's own dialog,
so the plugin never sees it. Their key is stored encrypted on the server
and only sent to the address they approved there.

## What is sent where

| When the user clicks | What is sent to the AI service |
| --- | --- |
| Write | The instruction, the subject and the working text |
| Rewrite, Translate, Check spelling and grammar | The working text |
| Summarize, To-dos and dates, Reply ideas | Sender, date, subject and text of the open message |
| Summarize this conversation | Sender, date, subject and text (without quotes) of up to 20 messages |

Nothing else leaves the webmail. In the browser the plugin keeps the
user's choices and which services they confirmed, and, while a composer
is open, a copy of the draft's subject and text so the assistant dialog
can start from it (removed when the composer closes).

## Permissions

| Permission | Why |
| --- | --- |
| `email:read` | Read the open message and conversation for summaries, and the draft (onDraftChange) for the composer |
| `http:proxy` | Send requests to the AI service through the webmail's server, which adds the API key |
| `admin:config` | Read the administrator's settings (addresses and models; the host never hands out the keys) |
| `ui:email-banner` | The bar above a message and the conversation summary (`email-banner`, `thread-summary`) |
| `ui:composer-toolbar` | The Assistant button in the composer |
| `ui:settings-section` | The plugin's settings page |

## Credentials

| Id | Set up by | Sent as |
| --- | --- | --- |
| `openai` | administrator | `Authorization: Bearer <key>` to the OpenAI-compatible address |
| `anthropic` | administrator | `x-api-key: <key>` to the Anthropic address |
| `own-openai` | user, if allowed | `Authorization: Bearer <key>` to the address the user approved |
| `own-anthropic` | user, if allowed | `x-api-key: <key>` to the address the user approved |

## Errors

The user gets a plain sentence instead of an error code: the key was
refused (401), no permission for the model (403), unknown model or
address (404), too many requests (429, with the wait time from
`retry-after` and a Try again button that waits it out), no credit left,
service overloaded (529/503), no answer for 60 seconds, text too long,
or the service can't be reached.

## Tests

```
node node_modules/vitest/vitest.mjs run ai-assistant
BULWARK_ADMIN_PASSWORD=... node node_modules/@playwright/test/cli.js test -c e2e/playwright.config.mjs ai-assistant/e2e
```

The end-to-end tests need the webmail and `test-env` running, with
Ollama (`up.ps1 -WithAI`). They use the Anthropic and OpenAI mocks
(`http://localhost:18099`) for the error cases, and Ollama for answers,
through both its OpenAI-compatible and its Anthropic API. The success
cases also run against the mocks once the mock container reads chunked
request bodies (the webmail's proxy streams every request body; fixed in
`test-env/mocks/server.py`, restart `bpt-mocks` to pick it up); until then
they are skipped. `e2e/seed_thread.py` adds a three-message conversation
to alice's inbox for the conversation summary.

## Screenshots

| | |
| --- | --- |
| ![Rewrite, light](screenshots/composer-rewrite-ollama-openai-compatible-light.png) | ![Rewrite, dark](screenshots/composer-rewrite-ollama-anthropic-messages-api-dark.png) |
| ![Grammar, light](screenshots/composer-grammar-light.png) | ![Grammar, dark](screenshots/composer-grammar-dark.png) |
| ![Summary, light](screenshots/reader-summary-light.png) | ![Summary, dark](screenshots/reader-summary-dark.png) |
| ![Reply ideas](screenshots/reader-replies-light.png) | ![Conversation on a phone](screenshots/thread-summary-phone-light.png) |
| ![Rate limit](screenshots/composer-rate-limit-light.png) | ![Settings, dark](screenshots/settings-own-key-dark.png) |
