---
name: gpio-rich-output
description: >-
  Make your chat replies render richly in the Open Code chat (dashboard web
  /devices/code, desktop Code tab, mobile Code tab): images and custom styled
  containers inside normal markdown. Use whenever a reply benefits from a
  photo/diagram/screenshot, a note box, a wiring checklist, or a step guide.
  Plain markdown stays the fallback; the renderer strips unsafe HTML to text.
---

# gpio-rich-output

Your Open Code chat output is markdown that also accepts a small, sanitized
set of HTML. Use it to show images and styled containers; everything unsafe is
shown as plain text, so never rely on scripts, event handlers, or exotic tags.

## Where it renders

- Dashboard web: Open Code chat on `/devices/code`.
- Desktop and mobile: the Code tab chat.
- Renders in assistant replies only; your tool output text is untouched.

## Images

Prefer markdown image syntax with a remote `https://` URL:

```md
![LED on breadboard](https://example.com/led-breadboard.png)
```

An inline HTML image also works and can carry width/height:

```md
<img src="https://example.com/schematic.png" alt="Schematic" width="480">
```

Rules:

- Remote `http(s)://` URLs only. `data:`, `javascript:`, and local/relative
  paths are stripped — the alt text shows instead.
- An image alone in a paragraph renders as a large centered block image.
- Host images yourself (GitHub raw links in the project repo are ideal).

## Custom containers

Wrap content in any lowercase tag — the renderer turns it into a styled card
and re-parses the inside as markdown:

```md
<board-note>
**Heads up:** pin 7 is physical pin 7, not BCM GPIO7.
</board-note>

<wiring-check>
- [x] 330 ohm resistor on pin 11
- [ ] LED ground rail shared with the sensor
</wiring-check>

<step-guide title="Blink in 3 steps">
1. Write `host/blink/main.c`
2. `gpio-companion sketch run --path host/blink`
3. Watch Serial in the console dock
</step-guide>
```

- Tags must be all-lowercase (`board-note`, not `BoardNote`).
- Unknown lowercase tags get a generic card style; known ones
  (`board-note`, `wiring-check`, `step-guide`) get accent styling. Invent
  new tags freely — they degrade to a generic card on every app.
- Containers can nest markdown: headings, lists, tables, code, images.
- Attributes are limited to `class`, `style`, `title`, `align`, `start`,
  `width`, `height`, `src`, `href`, `alt`. Everything else (and `on*`
  handlers) is dropped.

## What never renders

`<script>`, `<iframe>`, `<style>`, `<form>`, `<meta>`, `<link>`, `<embed>`,
`<object>` and unclosed/malformed tags are shown as literal text. Never use
them; they are a signal something went wrong, not a feature.

## Fallback discipline

Keep normal markdown as the backbone: headings, lists, tables, fenced code.
Use images and containers to *highlight*, not to carry essential structure —
if a renderer is old, the reply must still read cleanly as plain markdown.
