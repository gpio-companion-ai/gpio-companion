---
name: xai-voice
description: >-
  Extra delivery rules for speech mode when the user's Profile voice engine is
  xAI Voice (xAI text-to-speech). Adds inline tags like [pause] and [laugh] and
  wrapping tags like <whisper>, <slow>, <soft> inside the <speech> blocks of
  speech mode. Read together with the speech-mode skill whenever the prompt
  says the voice engine is xAI voice.
---

# xai-voice

This skill only applies when the selected voice engine is **xAI voice**. With
the Workers AI engine, never use these tags — they would be read aloud
literally. Check which engine the prompt names before using them.

Everything in the `speech-mode` skill still applies: be verbose, open the turn
with your plan, narrate each step, put the substance inside the tags. This
skill only adds **expressive delivery**.

## Inline tags — `[tag]`

Place at the exact point where the expression happens:

- Pauses: `[pause]`, `[long-pause]`, `[hum-tune]`
- Laughter and crying: `[laugh]`, `[chuckle]`, `[giggle]`, `[cry]`
- Mouth sounds: `[tsk]`, `[tongue-click]`, `[lip-smack]`
- Breathing: `[breath]`, `[inhale]`, `[exhale]`, `[sigh]`

## Wrapping tags — `<tag>text</tag>`

Wrap a complete phrase to change how it is delivered:

- Volume and intensity: `<soft>`, `<whisper>`, `<loud>`, `<build-intensity>`, `<decrease-intensity>`
- Pitch and speed: `<higher-pitch>`, `<lower-pitch>`, `<slow>`, `<fast>`
- Vocal style: `<sing-song>`, `<singing>`, `<emphasis>`

Combine styles: `<slow><soft>Goodnight, sleep well.</soft></slow>`

## Rules

- Use tags sparingly — one or two per `<speech>` block is enough; never stack
  more than one inline tag at the same point.
- Wrap complete phrases, not single words.
- Keep tags **inside** the `<speech>...</speech>` blocks — outside tags are for
  the transcript, not the voice.
- Keep an eye on punctuation: tags combine best with commas and periods, not
  with other tags.
- Full tag and voice reference: `https://docs.x.ai/developers/model-capabilities/audio/text-to-speech`
  (voice list via `GET /v1/tts/voices`).

## Example

```
<speech>Here is the plan: I check the proxy, then I run the fade sketch. [pause] Here we go.</speech>
<speech>The Arduino is connected, so I am driving it over USB. <whisper>And leaving the fragile header pins alone.</whisper></speech>
<speech>The fade works. [long-pause] About two seconds per cycle, four milliseconds a step. <soft>Ready for the next step whenever you are.</soft></speech>
```
