# Learn gpio-companion

Welcome to your electronics workbench. gpio-companion connects three things:

- **Project** holds your circuit designs and code on GitHub.
- **Devices** manages your Raspberry Pi or Orange Pi, WiFi, Code, and updates.
- **Code** opens the in-app agent, where you can describe what you want to build.

You do not need to know Linux, Git, or C to begin. Start with an LED, ask questions as you go, and let the agent prepare the wiring and code.

## Start here

1. [Set up your workbench](./getting-started.md) and create your first project.
2. Open the pinout for your board before connecting a wire.
3. Follow [Build, run, and save](./workflows.md) for your first LED project.

## Pick a guide

| Guide | Use it when you want to… |
| --- | --- |
| [Getting started](./getting-started.md) | Pair your board and create your first project |
| [Build, run, and save](./workflows.md) | Work with the agent, test a circuit, and save the result |
| [WiFi and Bluetooth](./wifi-bluetooth.md) | Connect a board or fix a network problem |
| [Removable storage](./storage.md) | Use an extra SD card or USB drive in Code |
| Raspberry Pi pinout | Find safe physical pins on a Raspberry Pi |
| Orange Pi pinout | Find safe physical pins on an Orange Pi |

## Your first bench kit

For the first activity, gather:

- a configured gpio-companion board and its power supply
- a breadboard
- one LED
- one resistor from **220 Ω to 1 kΩ**
- two jumper wires
- a GitHub account

The resistor matters: it limits current so the LED and GPIO pin stay safe.

## Three rules that protect your board

1. Turn off power before moving wires.
2. GPIO uses **3.3 V logic**. Never send 5 V into a GPIO pin.
3. Use **physical pin numbers**, meaning the numbered holes on the header. Check your board's pinout instead of guessing.

If something looks hot, smells unusual, or behaves unexpectedly, disconnect power first. A careful pause is part of electronics, not a failure.

## A note for image builders

These lessons assume your board already runs gpio-companion. Creating an Armbian image, configuring Cloudflare, and installing host services are operator tasks documented in `documentation/host/device-image.md` in the source repository.
