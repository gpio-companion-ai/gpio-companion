---
name: bug-report
description: >-
  File a gpio-companion bug or enhancement from the onboard agent. Use when a
  gpio-companion dashboard, companion, or agent defect is real, or when you
  keep applying the same workaround and the product should do that itself.
  Sends the report to the support worker. Attaches recent browser console
  errors and failed app requests when a dashboard app is open.
---

# bug-report

File a bug or an enhancement. You run the board command yourself. **Never** tell the user the command. **Never** curl loopback.

The command talks to the support worker. The worker emails `support@gpio-companion.com` and stores the same message for the support bot. The user still gets the inbox copy.

## When to file

File a **bug** when you have seen a real gpio-companion failure: a dashboard error, a companion command that should work and does not, a wrong locked behavior, or a crash. Include what you expected and what happened.

File an **enhancement** when you repeat the same workaround so the user can finish, and the product should do that step itself. Say what you keep doing by hand and what the product should do instead.

Do not file guesses, one-off user mistakes, or hardware that is simply unplugged. Do not file secrets, tokens, or pairing keys. The command strips secrets, but do not put them in the text.

## Send

```sh
gpio-companion bug-report submit --kind bug --title "Dock does not open" --body "Expected the dock. The app stayed on Project. Console and failed requests are attached when an app is open."
gpio-companion bug-report submit --kind enhancement --title "Remember the last sketch" --body "I keep re-selecting the sketch after every flash. The project should reopen the last sketch."
```

`--kind` is `bug` or `enhancement`. `--title` is one line. `--body` is the report: what happened, what you expected, and the workaround if this is an enhancement.

The command asks the open dashboard app for recent diagnostics, then submits. If no app is open, it still sends the report and says diagnostics were unavailable. Say that once to the user. Do not retry-spam.

## Browser console and network

This is not the full Chrome network tab. When web, desktop, or mobile is open on this board, the app keeps a short ring of:

- `console.error` and `console.warn`
- unhandled page errors
- failed `fetch` calls from that app (method, path, status)

Those lines are attached automatically. Do not invent console lines or status codes the command did not return. If the reply has no `console` or `network` arrays, say the app did not send diagnostics.

A board must Update companion before `bug-report submit` exists. If the command is unknown, say the board needs an update and do not invent a curl.
