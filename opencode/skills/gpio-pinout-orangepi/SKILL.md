---
name: gpio-pinout-orangepi
description: >-
  Orange Pi GPIO header mapping for gpio-companion. Use when hardware is
  orangepi, wiring a breadboard/PCB, or driving GPIO. Drive with C
  (`gpio-companion proxy status` first; if connected gpio-arduino-proxy, else
  gpio-host); `gpio set` is one-shot testing only. Orange Pi 3 LTS is a 26-pin
  header (not 40). SoC lines are NOT BCM. Talk physical pin numbers. 3.3V logic.
---

# Orange Pi GPIO pinout

Use this map whenever a circuit connects to an Orange Pi header. Orange Pi models differ, so first confirm the exact board shown in **Devices**.

## The two facts to remember

1. GPIO uses **3.3 V logic**. Never feed 5 V into a GPIO or connect 3.3 V directly to 5 V.
2. gpio-companion uses **physical pin numbers**: the numbered holes you can see. Orange Pi signal names such as `PD22` are not Raspberry Pi BCM numbers.

gpio-companion **Orange Pi 3 LTS** boards have a **26-pin** header. That map appears below. For another model, read [Other Orange Pi boards](#other-orange-pi-boards) before wiring.

## Safety

- Start an LED on physical **7**, with a **220 Ω to 1 kΩ resistor** in series to GND (pin 6 or 9).
- Do not use pins **8** and **10** for projects — they are often the serial console.
- This 26-pin header has **no analog input**. analogRead is not available.

## Try your first LED

With the board powered off:

1. Connect physical pin **7** to a resistor.
2. Connect the resistor to the LED's long leg.
3. Connect the LED's short leg to GND on physical pin **9**.
4. Compare the circuit with the breadboard diagram from the agent.
5. Restore power and use **Run on board** to start the blinking sketch.

If the LED does not light, disconnect power and turn the LED around. LEDs only conduct in one direction.

## Orange Pi 3 LTS — 26-pin header

Orient the board with the header on the board edge. Pin 1 (3V3) is top-left. There are **no pins 27–40**.

```
 3V3  (1)  (2)  5V
SDA   (3)  (4)  5V
SCL   (5)  (6)  GND
GPIO  (7)  (8)  TXD
 GND  (9) (10)  RXD
GPIO (11) (12) GPIO
GPIO (13) (14) GND
GPIO (15) (16) GPIO
 3V3 (17) (18) GPIO
MOSI (19) (20) GND
MISO (21) (22) GPIO
SCLK (23) (24) CS
 GND (25) (26) GPIO
```

| Physical | Name | Notes |
| ---: | --- | --- |
| 1 | 3V3 | Power |
| 2 | 5V | Power — never into a GPIO |
| 3 | PD26 | I2C SDA (TWI0) |
| 4 | 5V | Power — never into a GPIO |
| 5 | PD25 | I2C SCL (TWI0) |
| 6 | GND | Ground |
| 7 | PD22 | GPIO — good first LED / jumper |
| 8 | PL2 | UART TX — often the serial console; avoid |
| 9 | GND | Ground |
| 10 | PL3 | UART RX — often the serial console; avoid |
| 11 | PD24 | I2C SDA (TWI2) |
| 12 | PD18 | GPIO |
| 13 | PD23 | I2C SCL (TWI2) |
| 14 | GND | Ground |
| 15 | PL10 | GPIO |
| 16 | PD15 | GPIO |
| 17 | 3V3 | Power |
| 18 | PD16 | GPIO |
| 19 | PH5 | SPI MOSI (shared with TWI1 SCL) |
| 20 | GND | Ground |
| 21 | PH6 | SPI MISO (shared with TWI1 SDA) |
| 22 | PD21 | GPIO |
| 23 | PH4 | SPI CLK |
| 24 | PH3 | SPI CS |
| 25 | GND | Ground |
| 26 | PL8 | GPIO |

## Common jobs

- **Ordinary digital input/output:** start with 7, 12, 16, 18, or 22.
- **I2C sensors and displays:** pins 3/5 or 11/13.
- **SPI devices:** pins 19, 21, 23, and 24.
- **Ground:** 6, 9, 14, 20, or 25.
- **3.3 V power:** 1 or 17. **5 V power:** 2 or 4; never connect it to GPIO.

On **Project → Board tools → Live GPIO**, choose **Companion** to see the names detected for this header. Tap a safe GPIO to reveal its temporary test controls. Use **Run on board** for lasting behavior such as PWM or tone.

## Other Orange Pi boards

On Pi-style 2×20 headers, **physical power and ground seats match the Raspberry Pi**. GPIO functions do not — never use BCM numbers.

Some models are **26-pin** (or 26+13). If the silkscreen stops at 26, ignore physical 27–40.

Use Live GPIO on Project, or ask the on-device agent, for the map of *this* board. A pin marked unresolved cannot be driven safely.

## Agent reference

The remainder is for the on-device agent. Bench users can stop here.

Load when `/etc/gpio-companion/config.json` has `"hardware": "orangepi"`, or `/proc/device-tree/model` contains Orange Pi.

1. `gpio-companion gpio get` first — that snapshot is the live map (physical, name, dir, value, PWM). Do not rediscover with WiringOP or `gpioset`.
2. **C-first:** `gpio-companion proxy status` first. If connected, skill `gpio-arduino-proxy` (Arduino pins, `host/arduino-proxy-<name>/`) — not this header. Else drive header GPIO with a C sketch (skill `gpio-host`, **physical** pins). Never BCM. Blink/PWM/tone/loops go to `gpio-companion sketch run --path <dir>`. `gpio set` only for a one-shot test the user asked for: `gpio-companion gpio set --physical 7 --dir out --value 1`. analogWrite/tone in C, or skill `gpio-pwm` for a test. Breadboard: `gpio-breadboard`.
3. Technical sheets: **physical pin + name** (pin 7 / PD22), never a Pi BCM number. Push `technical/` and `breadboard/diagram.json`.
4. Refuse power, GND, and `unresolved` pins. On 3 LTS ignore 27–40. analogRead only if the snapshot has `adc` (3 LTS header has none).
5. Family boards without a SKU map: only drive pins the snapshot does not mark unresolved.
