---
name: speech-mode
description: >-
  How to talk when the Code page voice mode is active: the user hears your reply
  by voice (text-to-speech) and only hears what is inside <speech>...</speech>
  tags. Be verbose: narrate the plan and every step out loud, with the
  substance inside the tags. Use whenever a prompt contains speech mode or
  <speech> instructions.
---

# speech-mode

When speech mode is active, the user is **listening**, not reading. The client
speaks everything you wrap in `<speech>...</speech>` tags out loud, in order,
as you produce it. **If it is not in a tag, the user does not hear it.**

## Be verbose, not terse

- Read this skill before answering when speech mode is on.
- **Open every turn with a tag** describing what you are about to do and why:
  the plan, the goal, what you expect to find.
- **Narrate before each step.** Before reading files, running a sketch,
  editing, flashing, or checking anything, say in a tag what you are doing
  next and why it matters for the goal.
- **Put the substance inside the tags.** The user hears only tags, so tags
  carry the meaning: results, decisions, causes, numbers said in plain words
  ("about two seconds per cycle", "a 330 ohm resistor"). Do not put only
  pleasantries inside tags and details outside — that leaves the user
  uninformed.
- A tag is a spoken paragraph: one to four sentences. Several tags per turn is
  normal for real work.
- Close the turn with a tag summarizing what was done and what is next.

## What stays outside the tags

- Code blocks, exact file paths, pin tables, command output, long lists kept
  for the transcript record. The user can read them later; say the short
  spoken version inside a tag.

## Style

- Spoken text must read naturally out loud: no markdown, no bullets, no
  symbols, no emoji.
- Prefer "the board" / "the sketch" over repo paths and jargon; translate
  numbers into plain words.
- Never put secrets, keys, or tokens inside a tag.
- When you ask a question, wrap the question itself in a tag so the user hears
  it.
- If a step takes a while (a long compile), say so once in a tag instead of
  narrating every poll.

## Example

```
<speech>Here is what I am going to do: first I check whether an Arduino board is plugged in, because that decides whether I drive the pins through USB or the header. Then I write the fade sketch and run it.</speech>
<speech>An Arduino Uno is connected, so I will use it as a five volt proxy and leave the header pins alone. I am now writing the fade sketch under the project folder.</speech>
... write host/arduino-proxy-fade/main.c, POST /v1/run ...
<speech>The sketch compiles and is running. The fade goes from zero to full brightness in about two seconds per cycle, four milliseconds per step.</speech>
<speech>Summary: the fade works through the proxy, the branch is clean, and next I can wire the real relay module if you want.</speech>
```
