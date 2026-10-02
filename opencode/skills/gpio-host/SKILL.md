---
name: gpio-host
description: >-
  Default (C-first) way to drive gpio-companion header GPIO: compile/run
  Arduino-style C (.c/.ino) with the gpio-companion board CLI (gpio-companion
  sketch run). Use for blinks, LEDs, PWM, tone, loops, sketches, circuits,
  and lasting pin control — but only after `gpio-companion proxy status`.
  If connected, skill gpio-arduino-proxy instead (do not write a
  companion-header sketch). gpio set is testing-only. Not USB flash.
---

# gpio-host

This is the **default** way to drive this board's GPIO header **when no USB
Arduino proxy is connected**. Prioritize a C script over direct GPIO control.

## Check proxy first

Before creating any sketch file, breadboard, or pin drive:

```sh
gpio-companion proxy status
```

You run that board command yourself (it calls loopback `http://127.0.0.1:4150`
for you). **Never** tell the user to curl it or run board commands.

If `connected` is true: **stop**. Do **not** write `host/<name>/` with physical
header pins. Skill `gpio-arduino-proxy`: `host/arduino-proxy-<name>/`, Arduino
pin numbers, `gpio-companion sketch run --path <dir>`, and a
`gpio-arduino-proxy` part in `breadboard/diagram.json`.

If `connected` is false (or the user explicitly asked for this companion
header):

- Write a `.c`/`.ino` under `~/projects/<repo>/host/<sketch>/` and run
  `gpio-companion sketch run --path <dir>`.
- Do **not** `gpio-companion gpio set` or skill `gpio-pwm` unless the user asked
  to **probe a pin** or **verify Live GPIO** — one-shot, then stop.
- Blink, PWM, tone, loops, and lasting drive always go here, even if a gpio set
  would work.

Do **not** shell `gcc`. Use the board CLI. Pins are **physical** header
numbers (not Arduino Uno D-numbers). This is not a drop-in flash sketch.

## User vs you

You run the board CLI yourself. **Never** tell the user to run board commands
or `curl` `127.0.0.1:4150` (e.g. `sketch stop`).

If the user should start or stop a sketch: dashboard **Project → Run on board**
(pick the sketch name, Start / Stop). Same panel on desktop and mobile. Do not
ask them for a Pi path. To check wiring against `breadboard/diagram.json`, send
them to **Project → Verify circuit** (`gpio-companion verify start --repo <name>`)
— not a lasting gpio set.

## Board CLI (agent only)

```sh
gpio-companion sketch run --path ~/projects/<repo>/host/<name>
gpio-companion sketch status
gpio-companion sketch stop
gpio-companion sketch list
```

- `sketch run --path <dir>` — compile+start (dir must contain a `.c` or `.ino`)
- `sketch status` — `{ running, log, last }` (add `--json` for raw JSON)
- `sketch list` — host sketches under `~/projects/<repo>/host/`
- `sketch stop` — stop the running sketch

`--path` accepts a relative path (resolved from your cwd) or an absolute Pi path.
Put each sketch in `~/projects/<repo>/host/<name>/` (one directory per sketch)
and `git push` `host/` on a **feature branch**. Ask to save; merge `main` only
when the user says yes (skill `gpio-companion` **Project git**). The dashboard
lists those names from the board copy.

Poll `sketch status` until `running` is false, or stop a looping sketch.
Do not start a second job while one is running (409).

## Live GPIO while a sketch runs

While a sketch runs, Live GPIO keeps working **read-only**: the shim publishes
each touched pin's mode/value/analog duty/tone Hz to the companion, so the
dashboard/desktop/mobile 40-pin header shows the sketch's state live. Header
writes (`gpio-companion gpio set`, websocket drive) are refused with **409**
while the sketch runs — stop the sketch first to drive pins from the panel.

## Sketch

```c
#include "Arduino.h"

void setup() {
  pinMode(7, OUTPUT);
}

void loop() {
  digitalWrite(7, HIGH);
  delay(500);
  digitalWrite(7, LOW);
  delay(500);
}
```

`setup` / `loop`, `pinMode`, `digitalWrite` / `digitalRead`, `analogWrite`,
`tone` / `noTone`, `delay` / `millis`. `analogRead` is honest when the header
has no ADC. `Serial.print` / `println` / `printf` go to Project **Run on board** live Serial over the companion WebSocket. Do not tell the user board commands.
