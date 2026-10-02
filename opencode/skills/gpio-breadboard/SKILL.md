---
name: gpio-breadboard
description: >-
  Generate a Wokwi-style breadboard diagram.json so the gpio-companion dashboard
  can show how to plug parts and jumpers. Use when wiring a breadboard, mapping
  GPIO header or Arduino-proxy pins to holes, finishing a bench test circuit,
  or drawing a blink/LED sketch preview. Always run `gpio-companion proxy
  status` first; if connected, require a gpio-arduino-proxy part and Arduino
  pin wires.
---

# gpio-breadboard

Write a plug map the dashboard can render. Do **not** use tscircuit for this file (tscircuit is for `pcb/`).

## Check proxy first

```sh
gpio-companion proxy status
```

You run that board command yourself. **Never** tell the user board commands.

Do not write `diagram.json` until this returns.

If `connected` is true: the circuit is on the USB Arduino. Require a
`gpio-arduino-proxy` part. `attrs.board` and the wire prefix are `board` from
that JSON (`mega`, not `uno`, when the proxy is a Mega). MCU wires use that
prefix (`mega:13`, `mega:A0`, `mega:GND` — or `uno:` only when `board` is
`uno`). Never `header:13` for that net. Drive pins with skill
`gpio-arduino-proxy` (`host/arduino-proxy-<name>/`). Do not mix
companion GPIO and Arduino GPIO on one net. Do not mix 3V3 and 5V. AVR 5V must
not jumper to this companion's 3.3V header.

If `connected` is false: drive the companion header (skill `gpio-host`,
`gpio-companion sketch run --path <dir>`). `gpio-companion gpio set` is
one-shot testing only.

Project **Verify circuit** (`gpio-companion verify start --repo <name>`) treats
this diagram as a wiring contract: breadboard rows `a–e` / `f–j` and each rail
polarity are nets. Continuity needs two GPIOs on one net (companion header
**or** Arduino, not mixed). A lone GPIO (typical LED) is unknown electrically.

## Output

When a breadboard wiring task is done, write these files on a **feature branch** (`feat/<kebab>`), `git push` that branch, then ask if the user wants to save to `main` (skill `gpio-companion` **Project git**). Merge `main` only when they say yes:

- `breadboard/diagram.json` (required) — Wokwi [diagram.json](https://docs.wokwi.com/diagram-format) plus gpio-companion header and, when the proxy is live, `gpio-arduino-proxy`
- `breadboard/preview.svg` (optional)

## diagram.json

Companion header only (`connected` false):

```json
{
  "version": 1,
  "editor": "gpio-companion",
  "parts": [
    { "id": "bb1", "type": "wokwi-breadboard-half", "left": 80, "top": 0 },
    {
      "id": "header",
      "type": "gpio-companion-header",
      "left": 0,
      "top": 40,
      "attrs": { "hardware": "raspberrypi" }
    },
    {
      "id": "led1",
      "type": "wokwi-led",
      "attrs": { "color": "red" }
    }
  ],
  "connections": [
    ["header:11", "bb1:10a", "yellow", ["h20"]],
    ["led1:A", "bb1:10e", "green", []],
    ["led1:C", "bb1:11e", "green", []],
    ["header:6", "bb1:tn.1", "black", []]
  ],
  "steps": [
    { "text": "LED anode in row 10 column e, cathode in row 11", "highlight": ["led1"] }
  ]
}
```

USB Arduino proxy live (`connected` true) — MCU wires on `uno:*`, not `header:*`:

```json
{
  "version": 1,
  "editor": "gpio-companion",
  "parts": [
    { "id": "bb1", "type": "wokwi-breadboard-half", "left": 80, "top": 0 },
    {
      "id": "header",
      "type": "gpio-companion-header",
      "left": 0,
      "top": 40,
      "attrs": { "hardware": "raspberrypi" }
    },
    {
      "id": "uno",
      "type": "gpio-arduino-proxy",
      "left": 420,
      "top": 40,
      "attrs": { "board": "uno" }
    },
    {
      "id": "led1",
      "type": "wokwi-led",
      "attrs": { "color": "red" }
    }
  ],
  "connections": [
    ["uno:13", "bb1:12a", "orange", []],
    ["led1:A", "bb1:12e", "green", []],
    ["led1:C", "bb1:13e", "green", []],
    ["uno:GND", "bb1:tn.3", "black", []]
  ],
  "steps": [
    { "text": "LED anode in row 12 column e, cathode in row 13; Arduino D13 and GND", "highlight": ["led1", "uno"] }
  ]
}
```

## Rules

- Load `gpio-pinout-raspberrypi` or `gpio-pinout-orangepi` from `/etc/gpio-companion/config.json` `hardware` before placing jumpers.
- `gpio-companion-header` pins are **physical** 1–40. `attrs.hardware` must be `raspberrypi` or `orangepi`.
- `gpio-arduino-proxy` is the USB Arduino (Uno/Nano/Mega/MKR/Zero/ESP32). Required when `gpio-companion proxy status` is connected. `attrs.board` is that `board` (`uno`, `nano`, `mega`, `nano_33_iot`, `mkrwifi1010`, `mkrzero`, `mzero`, `esp32`, `esp32s3`, `esp32c3`). Wire prefix matches that id: `mega:13` / `mega:A0` on a Mega, `uno:13` only on an Uno, plus `5V` / `3V3` / `GND` / `VIN`. Mega A0 is pin 54, not 14. Place it beside the breadboard like the companion header. Do not mix AVR 5V with companion 3V3.
- Always include one `wokwi-breadboard-half` (30 rows), `wokwi-breadboard` (63), or `wokwi-breadboard-mini`.
- Portrait plug map: columns `a`–`e` then `f`–`j` on X, rows `1`–`30` down Y. Power rails are vertical on both long sides. Left: `tp.*` (+) then `tn.*` (−). Right: `bn.*` (−) then `bp.*` (+). Rail index matches the row (`tn.10` is beside `10a`). Mini has no rails.
- Breadboard holes: `{row}{column}` such as `10a` … `10e` / `10f` … `10j`. Rails: `tp.1`, `tn.1`, `bp.1`, `bn.1`.
- Plug components into holes (`led1:A` → `bb1:10e`). Do not park LEDs/resistors in empty canvas; the dashboard snaps them onto the connected holes.
- Part types for components: `wokwi-led`, `wokwi-resistor`, `wokwi-pushbutton`, and other `@wokwi/elements` names.
- Connections are `[from, to, color, wires]`. Endpoints are `partId:pin`.
- 3.3V logic only on this companion header. Never wire header 5V (physical 2, 4 on Pi-layout boards) into a GPIO pin.
- On Orange Pi, SoC line numbers are not BCM — confirm with `gpioinfo`.
- `steps` are plug instructions the dashboard highlights.

Then `git add breadboard/`, commit, `git push` the feature branch. Do not merge `main` until the user asks to save.
