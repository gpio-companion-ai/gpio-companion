---
name: gpio-arduino-proxy
description: >-
  USB Arduino as a Firmata slave/proxy on gpio-companion. Use for blinks, LEDs,
  PWM, sketches, breadboard, circuit, Arduino, Firmata, or proxy pin drive.
  Always GET /v1/arduino-proxy first; if connected write host/arduino-proxy-<name>/
  C, POST /v1/run, and add gpio-arduino-proxy to breadboard/diagram.json. Flash
  proxy firmware via POST /v1/flash/proxy. I2C/SPI/UART buses included.
---

# gpio-arduino-proxy

When a USB Arduino (AVR Uno/Nano/Mega, SAMD, or ESP32) is a **proxy**, this
companion drives every pin over Firmata. The MCU firmware stays the proxy.
Sketches run **on this Pi** (`POST /v1/run`), not as `/v1/flash` uploads.

Check first — before creating any sketch file, breadboard, or pin drive:

```sh
curl -s http://127.0.0.1:4150/v1/arduino-proxy
```

You call loopback yourself. **Never** tell the user to curl it. Do **not** write
`host/arduino-proxy-*` or a companion-header sketch until this GET returns.

If `connected` is false: do **not** invent a proxy sketch or assume Uno. Skill
`gpio-host` only when the user asked for this companion header. If they want the
USB board as a proxy, they flash from **Devices → Flash Arduino as proxy**. You
may `POST /v1/flash/proxy` `{ fqbn, port? }` only with the FQBN from
`GET /v1/flash/ports` (do not guess `arduino:avr:uno`).

If `connected` is true:

1. Read `board`, `fqbn`, and `pins` from that JSON. Do not assume Uno.
2. Write C in `~/projects/<repo>/host/arduino-proxy-<kebab>/` (prefix required).
3. Use **that board's** Arduino pin numbers, not companion header seats.
   LED_BUILTIN is 13. On Uno, A0 is pin 14. On Mega, A0 is pin **54** (not 14);
   digital pins run 0–53. Prefer `analogRead(A0)` over a hardcoded number.
   Live GPIO `dir:in` on analog pins reports `adc`.
4. `POST /v1/run` `{ dir }` with that absolute folder.
5. Write `breadboard/diagram.json` with a `gpio-arduino-proxy` part. `attrs.board`
   is `board` (`mega`, not `uno`, when the GET says mega). Wire prefix is that
   same id (`mega:13`, `mega:A0`, `mega:GND`). Skill `gpio-breadboard`. Do **not**
   map that circuit to `gpio-companion-header`.
6. Do **not** flash a project sketch unless the user asked — that replaces the proxy.
7. Skip D0/D1 on UART-USB AVR (Uno/Nano/Mega). SAMD/ESP32 native USB may use Serial1.

If a USB board is present and the user wants a proxy but it is not connected yet:
user flashes from dashboard **Devices → Flash Arduino as proxy**. First flash of a family installs only that
`arduino-cli` core (`arduino:avr`, `arduino:samd`, or `esp32:esp32`) — never
install cores during companion update. Supported FQBNs: `arduino:avr:uno`,
`arduino:avr:nano`, `arduino:avr:mega`, `arduino:samd:nano_33_iot`,
`arduino:samd:mkrwifi1010`, `arduino:samd:mkrzero`, `arduino:samd:mzero`,
`esp32:esp32:esp32`, `esp32:esp32:esp32s3`, `esp32:esp32:esp32c3`.

## Voltage

- AVR Uno/Nano/Mega: **5V** — do not jumper to this board's 3.3V header.
- SAMD and ESP32: **3.3V**.

## APIs

- `GET /v1/arduino-proxy` — `{ connected, protocol: "firmata", fqbn, pins, buses }`
- `POST /v1/flash/proxy` `{ fqbn?, port? }` — bundled ConfigurableFirmata-compatible firmware
- Live GPIO WS `{ target: "arduino-proxy", physical, dir, value }` and bus ops
  `i2c-scan` / `i2c-read` / `i2c-write` / `spi-xfer` / `uart-write`
- User UI: **Devices → Flash Arduino as proxy**, **Project → Live GPIO**
  (Companion | Arduino), **Project → Run on board** (`arduino-proxy-*`)

Project git: same feature-branch flow; push `host/arduino-proxy-<name>/` and
`breadboard/`.
