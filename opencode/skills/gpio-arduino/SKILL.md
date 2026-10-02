---
name: gpio-arduino
description: >-
  Flash Arduino C firmware over USB from a gpio-companion Pi. USB Arduino only
  — lasting drive is C-first (`gpio-companion proxy status`; if connected
  gpio-arduino-proxy, else gpio-host `sketch run`), not flash and not gpio set.
  Use when compiling or uploading a .c/.ino with the gpio-companion board CLI.
---

# gpio-arduino

USB Arduino only (`gpio-companion flash start`). Lasting pin drive is C-first:
`gpio-companion proxy status` first; if connected, skill `gpio-arduino-proxy`
(do not flash over a live proxy unless asked). Else this board's GPIO header is
skill `gpio-host` (`sketch run`), not flash and not `gpio set`.

To make the USB board a pin slave instead of flashing a project sketch: skill
`gpio-arduino-proxy` (`gpio-companion flash proxy`). A live proxy is replaced if
you `flash start` a project sketch.

Do **not** shell `avrdude` or `arduino-cli` directly. Use the board CLI.

You run that CLI yourself. **Never** tell the user board commands.
If the user should flash: dashboard **Project → Flash Arduino** (pick the sketch
name). Do not ask them for a Pi path.

## Board CLI (agent only)

```sh
gpio-companion flash ports
gpio-companion flash start --fqbn arduino:avr:uno --path ~/projects/<repo>/firmware/<name>
gpio-companion flash status
gpio-companion flash list
```

- `flash ports` — USB boards (`address`, optional `fqbn`)
- `flash list` — USB sketches under `~/projects/<repo>/firmware/`
- `flash start --fqbn <fqbn> --path <dir> [--port <port>]` — compile+upload
- `flash status` — `{ running, last }` (add `--json` for raw JSON)

`--path` accepts a relative path (resolved from your cwd) or an absolute Pi path
and must contain a `.c` or `.ino`. Firmware is **C**. Put each sketch in
`~/projects/<repo>/firmware/<name>/` (one directory per sketch) and `git push`
`firmware/` on a **feature branch**. Ask to save; merge `main` only when the
user says yes (skill `gpio-companion` **Project git**). The dashboard lists those
names from the board copy. Host GPIO sketches stay under `host/` and are not USB
drop-ins.

Poll `flash status` until `running` is false. Do not start a second job while one is running (409).

After a successful flash with `port` set, the board opens that USB serial and streams `Serial.print` to Project **Flash Arduino**. Users can also Open/Close serial there. Do not tell the user board commands.
