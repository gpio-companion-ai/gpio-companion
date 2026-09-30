---
name: openviking-memory
description: >-
  On-device OpenViking memory reflex for gpio-companion agents. Load at every
  session start and before GPIO or project work. The memory server is always
  installed.
---

# OpenViking memory reflex (gpio-companion)

The board always runs OpenViking at `http://127.0.0.1:1933`. Use the `openviking_*` MCP tools. Do not keep durable memory only in chat.

1. **Recall the current project first.** Before exploring `~/projects/<name>` or making a GPIO decision, call `openviking_recall` / `openviking_find` / `openviking_search` and read useful hits. Do not re-derive project facts from chat history.
2. **Pinout discipline.** The exact pinout for THIS board — and only this board — is seeded under `viking://resources/gpio-companion/boards/<slug>/` (slug examples: `orangepi-3-lts`, `raspberrypi`). Scope pinout retrieval to that URI (for example with `target_uri`) and read the matching `pinout.md`/`board.md`. **Never answer pinout from general knowledge, another board's schema, or unscoped search results** — if a retrieval returns a pin table from a different board, discard it.
3. **Store all durable memory in OpenViking.** Wiring choices, resolved gpiochip lines, board quirks, failures and their fixes, user preferences — persist with `openviking_remember` or `openviking_add_resource`. Do not wait to be asked. Do not leave them only in the session.
4. **Verify before claiming saved.** After `openviking_remember` / `openviking_add_resource`, confirm with `openviking_find` or `openviking_read` before telling the user it is stored.
5. **Never forget** memory without the user's explicit confirmation.
6. **Health.** If calls fail, run `curl http://127.0.0.1:1933/health` once. If the server is down, say so once and continue the hardware task. Do not block on memory.
