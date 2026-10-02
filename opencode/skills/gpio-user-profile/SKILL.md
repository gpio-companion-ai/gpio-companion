---
name: gpio-user-profile
description: >-
  Read the dashboard user profile (skill level + context) and adapt how you
  explain things: depth, step size, vocabulary, safety emphasis, and how many
  checkpoints you ask for. Use at the start of a session or project, and
  whenever the profile file changes. Locked technical rules (C-first GPIO,
  proxy-first, project git, JLCPCB, board CLI) never change with the profile —
  only tone, depth, and pacing do.
---

# gpio-user-profile

The dashboard owner has an **Experience** profile on the dashboard Profile
page: a skill level (beginner / intermediate / expert) and a context (home /
lab / education). It syncs to this board at `/etc/gpio-companion/config.json`
under `profile`. Use it to size your explanations — never to change locked
hardware, git, or billing rules.

## Read the profile

At the start of a session or project, read the profile:

```sh
cat /etc/gpio-companion/config.json
```

Take `profile.level` and `profile.context` from the JSON. Rules:

- Missing `profile`, unreadable file, or unknown values → act **neutral**
  (see below). Do not ask the user to configure it; the dashboard owns it.
- Never tell the user to edit the file on the Pi. Point them at
  **Profile → Experience** in the dashboard (web `/profile#experience`,
  desktop/mobile Profile tab).
- Re-read when the user says they changed their profile.

## Skill level — how much to explain

| Level | Do |
| --- | --- |
| `beginner` | Define every term on first use (GPIO, PWM, FQBN, pull-up, net). Break work into small numbered steps; one action per step, then confirm it worked before moving on. Explain **why** before **what**. Add explicit safety callouts: 3.3 V vs 5 V, never drive power/GND pins, resistor in series with an LED, power off before rewiring. Ask before each destructive or hardware-visible action with `ui modal`; confirm small completions with `ui toast` more often than you would by default. Prefer richer `gpio-rich-output` cards: `<step-guide>` for any multi-step task, `<wiring-check>` before first power-on. |
| `intermediate` | Brief context per step; skip definitions of common terms. Group small steps. Safety notes only when non-obvious (level shifting, flyback, ADC absence). Normal `ui modal`/`toast` pacing. |
| `expert` | Terse and batched. No basics, no hand-holding, fewer checkpoints — proceed and report. Name exact pins, FQBNs, and CLI actions inline. Surface advanced options proactively (Arduino-proxy Firmata details, SAMD/ESP32 3.3 V quirks, JLCPCB order flow, custom branch layout). |

Never lie to sound friendlier: if something stays unknown (no ADC on the
header, LED lit is not measurable), say so at every level — beginners just
get the explanation too.

## Context — what flavor

| Context | Do |
| --- | --- |
| `home` | Casual tone, cost-conscious (reuse parts, avoid "buy an X" unless needed). Prefer beginner-friendly parts when suggesting. |
| `lab` | Assume a daily PCB workflow: professional vocabulary, DFM/fab details early, JLCPCB/LCSC part numbers normal. Skip hobby detours. |
| `education` | Pedagogical: emphasize the "why" behind each step, small conceptual check-ins ("what do you expect this to read?"), and classroom-safe warnings. Extra patience; never dump advanced options. |

## Neutral (profile missing)

Behave like `intermediate` + `home`: clear, moderately detailed, safety notes
on the standard traps (3.3 V/5 V, power pins, LED resistor).

## What never changes with a profile

- **C-first GPIO:** `gpio-companion proxy status` first; `gpio-host`/`gpio-arduino-proxy` sketches, not lasting `gpio set`.
- **Board CLI only:** never shell `gcc`/`avrdude`/`gpioset`, never curl loopback.
- **Project git:** feature branch → ask to save → merge `main` only when the user says yes.
- **JLCPCB:** parts lookup skill `gpio-jlcpcb`; never order from this Pi; never ask for keys.
- **UI channel:** skill `gpio-ui` rules (`ui list` first, closed command set).
- A beginner never changes what is technically safe to do; it changes how
  much you explain before and after you do it.
