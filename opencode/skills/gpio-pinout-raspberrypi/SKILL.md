---
name: gpio-pinout-raspberrypi
description: >-
  Raspberry Pi 40-pin GPIO header for gpio-companion. Use when hardware is
  raspberrypi, wiring a breadboard/PCB, or driving GPIO. Drive with C
  (`gpio-companion proxy status` first; if connected gpio-arduino-proxy, else
  gpio-host); `gpio set` is one-shot testing only. Talk physical pins 1–40.
  3.3V logic. Avoid pins 27–28.
---

# Raspberry Pi GPIO pinout

Use this map whenever a circuit connects to the Raspberry Pi header. You do not need to memorize it: find the physical pin number, check its purpose, and wire with the power off.

## The two facts to remember

1. GPIO uses **3.3 V logic**. Never feed 5 V into a GPIO or connect 3.3 V directly to 5 V.
2. gpio-companion uses **physical pin numbers**: the numbered holes you can see. A BCM number is only another name for the signal.

## Find pin 1

On a Raspberry Pi 4 or 5, place the board with the 40-pin header on the right and the USB/Ethernet sockets toward you. **Pin 1** is the top-left header pin and carries 3.3 V.

The odd physical numbers run down one side; the even numbers run down the other. Always check the board orientation before counting.

## Safety

- Start an LED on physical **11** or **7**, with a **220 Ω to 1 kΩ resistor** in series to GND (pin 6 or 9).
- Do not use pins **27** and **28** — they are the HAT EEPROM.
- Pins **8** and **10** are UART TX/RX — often the serial console; avoid for projects.
- 5V is on pins 2 and 4 — never wire that into a GPIO.

## Try your first LED

With the board powered off:

1. Connect physical pin **11** to a resistor.
2. Connect the resistor to the LED's long leg.
3. Connect the LED's short leg to GND on physical pin **9**.
4. Compare the circuit with the breadboard diagram from the agent.
5. Restore power and use **Run on board** to start the blinking sketch.

If the LED does not light, disconnect power and turn the LED around. LEDs only conduct in one direction.

## 40-pin header

```
 3V3  (1)  (2)  5V
SDA   (3)  (4)  5V
SCL   (5)  (6)  GND
GPIO4 (7)  (8)  TXD
 GND  (9) (10)  RXD
GPIO17(11) (12) GPIO18
GPIO27(13) (14) GND
GPIO22(15) (16) GPIO23
 3V3 (17) (18) GPIO24
MOSI (19) (20) GND
MISO (21) (22) GPIO25
SCLK (23) (24) CE0
 GND (25) (26) CE1
ID_SD(27) (28) ID_SC
GPIO5(29) (30) GND
GPIO6(31) (32) GPIO12
GPIO13(33) (34) GND
GPIO19(35) (36) GPIO16
GPIO26(37) (38) GPIO20
 GND (39) (40) GPIO21
```

| Physical | Name | Notes |
| ---: | --- | --- |
| 1 | 3V3 | Power |
| 2 | 5V | Power — never into a GPIO |
| 3 | GPIO2 | I2C SDA (BCM 2) |
| 4 | 5V | Power — never into a GPIO |
| 5 | GPIO3 | I2C SCL (BCM 3) |
| 6 | GND | Ground |
| 7 | GPIO4 | GPIO (BCM 4) — good first jumper |
| 8 | GPIO14 | UART TX (BCM 14) — often console; avoid |
| 9 | GND | Ground |
| 10 | GPIO15 | UART RX (BCM 15) — often console; avoid |
| 11 | GPIO17 | GPIO (BCM 17) — good first LED |
| 12 | GPIO18 | GPIO / PWM (BCM 18) |
| 13 | GPIO27 | GPIO (BCM 27) |
| 14 | GND | Ground |
| 15 | GPIO22 | GPIO (BCM 22) |
| 16 | GPIO23 | GPIO (BCM 23) |
| 17 | 3V3 | Power |
| 18 | GPIO24 | GPIO (BCM 24) |
| 19 | GPIO10 | SPI MOSI (BCM 10) |
| 20 | GND | Ground |
| 21 | GPIO9 | SPI MISO (BCM 9) |
| 22 | GPIO25 | GPIO (BCM 25) |
| 23 | GPIO11 | SPI SCLK (BCM 11) |
| 24 | GPIO8 | SPI CE0 (BCM 8) |
| 25 | GND | Ground |
| 26 | GPIO7 | SPI CE1 (BCM 7) |
| 27 | GPIO0 | HAT EEPROM — do not use |
| 28 | GPIO1 | HAT EEPROM — do not use |
| 29 | GPIO5 | GPIO (BCM 5) |
| 30 | GND | Ground |
| 31 | GPIO6 | GPIO (BCM 6) |
| 32 | GPIO12 | GPIO / PWM (BCM 12) |
| 33 | GPIO13 | GPIO / PWM (BCM 13) |
| 34 | GND | Ground |
| 35 | GPIO19 | GPIO / PWM (BCM 19) |
| 36 | GPIO16 | GPIO (BCM 16) |
| 37 | GPIO26 | GPIO (BCM 26) |
| 38 | GPIO20 | GPIO (BCM 20) |
| 39 | GND | Ground |
| 40 | GPIO21 | GPIO (BCM 21) |

GND: 6, 9, 14, 20, 25, 30, 34, 39. 3V3: 1, 17. 5V: 2, 4.

## Common jobs

- **Ordinary digital input/output:** start with 7, 11, 13, 15, 16, 18, 22, 29, 31, 36, 37, 38, or 40.
- **I2C sensors and displays:** pins 3 and 5.
- **SPI devices:** pins 19, 21, 23, 24, and sometimes 26.
- **Hardware PWM:** pins 12, 32, and 33 are convenient choices.
- **Ground:** 6, 9, 14, 20, 25, 30, 34, or 39.

On **Project → Board tools → Live GPIO**, choose **Companion** to see this header. Tap a safe GPIO to reveal its temporary test controls. Use **Run on board** for lasting behavior.

## Agent reference

The remainder is for the on-device agent. Bench users can stop here.

Load when `/etc/gpio-companion/config.json` has `"hardware": "raspberrypi"`, or `/proc/device-tree/model` contains Raspberry Pi.

1. `gpio-companion gpio get` first — that snapshot is the live map (physical, name, dir, value, PWM).
2. **C-first:** `gpio-companion proxy status` first. If connected, skill `gpio-arduino-proxy` (Arduino pins, `host/arduino-proxy-<name>/`) — not this header. Else drive header GPIO with a C sketch (skill `gpio-host`, **physical** pins). Never BCM in the body. Blink/PWM/tone/loops go to `gpio-companion sketch run --path <dir>`. `gpio set` only for a one-shot test the user asked for: `gpio-companion gpio set --physical 11 --dir out --value 1`. analogWrite/tone in C, or skill `gpio-pwm` for a test. Breadboard: `gpio-breadboard`.
3. Technical sheets: **physical pin + name** so the user can see the header. Push `technical/` and `breadboard/diagram.json`.
4. Refuse power, GND, and physical 27–28. Do not `gpioset`.
