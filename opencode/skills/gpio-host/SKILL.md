---
name: gpio-host
description: >-
  Default (C-first) way to drive gpio-companion header GPIO: compile/run
  Arduino-style C (.c/.ino) via POST /v1/run. Use for blinks, LEDs, PWM, tone,
  loops, sketches, circuits, and lasting pin control — but only after GET
  /v1/arduino-proxy. If connected, skill gpio-arduino-proxy instead (do not
  write a companion-header sketch). PUT /v1/gpio is testing-only. Not USB flash.
---

# gpio-host

This is the **default** way to drive this board's GPIO header **when no USB
Arduino proxy is connected**. Prioritize a C script over direct GPIO control.

## Check proxy first

Before creating any sketch file, breadboard, or pin drive:

```sh
curl -s http://127.0.0.1:4150/v1/arduino-proxy
```

You call loopback yourself. **Never** tell the user to curl it.

If `connected` is true: **stop**. Do **not** write `host/<name>/` with physical
header pins. Skill `gpio-arduino-proxy`: `host/arduino-proxy-<name>/`, Arduino
pin numbers, `POST /v1/run`, and a `gpio-arduino-proxy` part in
`breadboard/diagram.json`.

If `connected` is false (or the user explicitly asked for this companion
header):

- Write a `.c`/`.ino` under `~/projects/<repo>/host/<sketch>/` and `POST /v1/run`.
- Do **not** `PUT /v1/gpio` or skill `gpio-pwm` unless the user asked to **probe
  a pin** or **verify Live GPIO** — one-shot, then stop.
- Blink, PWM, tone, loops, and lasting drive always go here, even if a PUT
  would work.

Do **not** shell `gcc`. Use the loopback run API. Pins are **physical** header
numbers (not Arduino Uno D-numbers). This is not a drop-in `/v1/flash` sketch.

## User vs you

You call the loopback API yourself. **Never** tell the user to `curl`
`127.0.0.1:4150` (or `/v1/run/stop`).

If the user should start or stop a sketch: dashboard **Project → Run on board**
(pick the sketch name, Start / Stop). Same panel on desktop and mobile. Do not
ask them for a Pi path. To check wiring against `breadboard/diagram.json`, send
them to **Project → Verify circuit** (`POST /v1/verify`) — not a lasting GPIO PUT.

## API (agent only)

```sh
curl -s -X POST http://127.0.0.1:4150/v1/run \
  -H 'content-type: application/json' \
  -d '{"dir":"/home/gpio/blink"}'
curl -s http://127.0.0.1:4150/v1/run
curl -s -X POST http://127.0.0.1:4150/v1/run/stop
```

- `POST /v1/run` `{ dir }` — compile+start, returns `{ started: true }`
- `GET /v1/run` — `{ running, log, last }`
- `GET /v1/run/sketches` — host sketches under `~/projects/<repo>/host/`
- `POST /v1/run/stop` — `{ stopped: true }`

`dir` is an absolute path on this Pi and must contain a `.c` or `.ino`.
Put each sketch in `~/projects/<repo>/host/<name>/` (one directory per sketch)
and `git push` `host/` on a **feature branch**. Ask to save; merge `main` only
when the user says yes (skill `gpio-companion` **Project git**). The dashboard
lists those names from the board copy.
Unsigned loopback only without Ed25519 headers; dashboard/BLE run is signed.

Poll `GET /v1/run` until `running` is false, or stop a looping sketch.
Do not start a second job while one is running (409).

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
has no ADC. `Serial.print` / `println` / `printf` go to Project **Run on board** live Serial over the companion WebSocket. Do not tell the user to curl `/v1/console`.
