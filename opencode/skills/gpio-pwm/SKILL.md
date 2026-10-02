---
name: gpio-pwm
description: >-
  Testing-only analogWrite, tone, and analogRead with the gpio-companion board
  CLI. Do not use for lasting PWM/tone — write C (`gpio-companion proxy
  status` first; if connected gpio-arduino-proxy, else gpio-host `sketch run`)
  instead. One-shot pin test only when the user asked to probe a pin or verify
  Live GPIO.
---

# gpio-pwm

**Testing only.** Prefer `analogWrite` / `tone` in a C sketch
(`gpio-companion proxy status` first; if connected skill `gpio-arduino-proxy`,
else skill `gpio-host`, `sketch run`). Use these board commands only when the
user asked to probe a pin or verify Live GPIO — one-shot, then stop. Not for
blinks, fades that should keep running, or tone sequences.

When testing, you drive PWM and tone with the board CLI.
Do **not** shell `gpio-pwm`, pyA20, orangepwm.py, or `gpioset` for analogWrite.
**Never** tell the user board commands — if they should probe a pin, send them
to dashboard **Project → Live GPIO**.

Load the pinout skill first (`gpio-pinout-orangepi` or `gpio-pinout-raspberrypi`).
Use **physical** pins 1–40. Refuse power, GND, Raspberry Pi 27–28, and unresolved
Orange Pi lines.

## analogWrite (software PWM)

Any driveable GPIO. Duty is Arduino 0–255 at ~490 Hz.

```sh
gpio-companion gpio set --physical 7 --dir pwm --analog 128
```

0 = solid low, 255 = solid high. Live GPIO websocket accepts the same shape.

## tone / noTone

```sh
gpio-companion gpio tone --physical 7 --hz 440
gpio-companion gpio notone --physical 7
```

`hz` must be 31–65535.

## digital

```sh
gpio-companion gpio set --physical 11 --dir out --value 1
gpio-companion gpio set --physical 11 --dir in
```

Digital in/out stops PWM/tone on that pin.

## analogRead

`gpio-companion gpio get` snapshot. A pin only has `adc` if the kernel exposes
IIO GPADC. Orange Pi 3 LTS 26-pin header has **no ADC** — do not invent a
number. Tell the user analogRead is unavailable on that header.

## Orange Pi 3 LTS

Hardware PWM1 in the device tree is PB19 (not on the header). `pwmchip0` exists
but header PWM is **software PWM** via the companion helper. Snapshot names use
SoC lines (PD22, …). Do not assume Raspberry Pi BCM or sysfs PWM0/PWM1 seats.

## Do not

- Use gpio set for lasting PWM/tone — write C and `sketch run` instead
- Spawn `/usr/local/lib/gpio-companion/gpio-pwm` yourself
- Use Python orangepwm / pyA20
- Treat header pin 7 as hardware PWM unless the snapshot shows `analog` or `pwm`
