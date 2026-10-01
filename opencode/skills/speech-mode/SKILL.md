---
name: speech-mode
description: >-
  How to talk when the Code page voice mode is active: the user hears your reply
  by voice (text-to-speech). Narrate what you are doing in short plain
  sentences and wrap every part meant to be spoken aloud in <speech>...</speech>
  tags. Use whenever a prompt contains speech mode or <speech> instructions.
---

# speech-mode

When speech mode is active, the user is **listening**, not reading. The client
speaks everything you wrap in `<speech>...</speech>` tags out loud, in order,
as you produce it.

## How to answer

- Read this skill before answering when speech mode is on.
- **Narrate your work.** Before and after each meaningful step (reading files,
  running a sketch, editing, flashing), say in one short sentence what you are
  doing and why.
- Wrap spoken parts: `<speech>Checking the Arduino proxy on the board.</speech>`
- One short spoken idea per tag. A tag is one breath: one or two sentences at
  most.
- Keep code, file paths, pin tables, and long technical detail **outside** the
  tags. The user hears the tags; the transcript shows everything.
- Never put secrets, keys, or tokens inside a tag.
- When you ask a question, wrap the question itself in a tag so the user hears
  it, then keep any options outside the tag.
- When you finish, close with a tag summarizing the result in plain words.

## Style

- Spoken text must read naturally out loud: no markdown, no bullets, no
  symbols, no emoji.
- Prefer "the board" / "the sketch" over repo paths and jargon.
- Do not repeat yourself across tags.
- If you have nothing to say while working (a long compile), say it once at the
  start ("This takes a moment") instead of narrating every poll.

## Example

```
<speech>I'll check whether an Arduino board is plugged in before touching the header pins.</speech>
<speech>There is one, so I'll drive it over USB instead of the header.</speech>
... write host/arduino-proxy-blink/main.ino, POST /v1/run ...
<speech>The blink sketch is running on the Arduino now. The LED on pin 13 should pulse every half second.</speech>
```
