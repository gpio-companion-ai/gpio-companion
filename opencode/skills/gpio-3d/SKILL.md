---
name: gpio-3d
description: >-
  Write printable parts for the current GitHub project. Use when the user
  wants a 3D-printed clip, spacer, shroud, or other part that fits the
  companion header and/or an Arduino Uno, Nano, or Mega. Output
  ~/projects/<repo>/model/ as one glTF (.glb) and one STL per part, plus
  model/manifest.json. Meshes come from trimesh, not tscircuit.
---

# gpio-3d

Write printable parts the project can show (`.glb`) and slice (`.stl`). Do **not** use tscircuit for meshes (tscircuit is for `pcb/`). Do **not** invent a CAD kernel or hand-write glTF/STL bytes.

## Tool

Meshes are written with [trimesh](https://github.com/mikedh/trimesh). The manifest `tool` is `trimesh`. Coordinates are **millimeters**. Do not scale to meters.

You install and run it yourself. **Never** tell the user to pip-install, and **never** tell them to curl loopback.

```sh
python3 -c "import trimesh" || pip install --user trimesh
```

```python
import trimesh

mesh = trimesh.creation.box((50.8, 5.08, 2.0))  # mm
mesh.export("model/header-clip.glb")
mesh.export("model/header-clip.stl")
```

One trimesh mesh per part. Export that same mesh to `.glb` (viewer) and `.stl` (print). A box, cylinder, `trimesh.boolean`, or `trimesh.Trimesh(vertices, faces)` is fine. A second mesh compiler is not.

## Which board

Before choosing `fits`, see whether a USB Arduino is the live board:

```sh
curl -s http://127.0.0.1:4150/v1/arduino-proxy
```

You call loopback yourself. **Never** tell the user to curl it.

If `connected` is true and the user did not ask for the companion header, fit the USB board from `fqbn`: `arduino-uno`, `arduino-nano`, or `arduino-mega`. Otherwise fit `companion-header`. Load `gpio-pinout-raspberrypi` or `gpio-pinout-orangepi` and size to that header (40-pin Raspberry Pi layout, or the shorter Orange Pi header). A part may list more than one board when the same 2.54 mm geometry fits each of them. Do not invent other board ids.

## Output

When a printable-part task is done, write these files on a **feature branch** (`feat/<kebab>`), `git push` that branch, then ask if the user wants to save to `main` (skill `gpio-companion` **Project git**). Merge `main` only when they say yes:

Directory: `~/projects/<repo>/model/`

- `model/<part>.glb` — one glTF binary per part (viewer)
- `model/<part>.stl` — same stem (print)
- `model/manifest.json` — required

No other files in `model/`.

## manifest.json

```json
{
  "version": 1,
  "units": "mm",
  "tool": "trimesh",
  "parts": [
    {
      "name": "header-clip",
      "file": "header-clip.glb",
      "units": "mm",
      "fits": ["companion-header"]
    },
    {
      "name": "arduino-header-clip",
      "file": "arduino-header-clip.glb",
      "units": "mm",
      "fits": ["arduino-uno", "arduino-nano", "arduino-mega"]
    }
  ]
}
```

## Rules

- `units` is `mm` only, on the manifest and on every part.
- `file` is one basename, kebab-case, ending in `.glb`. The print file is that stem with `.stl`.
- `fits` is one or more of `companion-header`, `arduino-uno`, `arduino-nano`, `arduino-mega`.
- `name` is unique. `file` is unique. Each `.glb` contains one mesh.
- Pitch is 2.54 mm. Size from the loaded pinout. Do not guess unpublished hole coordinates.
- Companion header is 3.3 V. Do not design a part that ties header 5 V into a GPIO.
- Validate before commit. The script sits next to this skill (repo `opencode/skills/gpio-3d/`, on device `~/.config/opencode/skills/gpio-3d/`):

```sh
bun ~/.config/opencode/skills/gpio-3d/validate-manifest.ts ~/projects/<repo>/model
```

Then `git add model/`, commit, `git push` the feature branch. Do not merge `main` until the user asks to save.

## Sample

`sample/model/` in this skill is a valid manifest, written with trimesh: a 50.8 × 5.08 × 2.0 mm clip for a 40-pin companion header (20 × 2.54 mm) and a 20.32 × 2.54 × 2.0 mm clip for an 8-pin Arduino header (Uno, Nano, and Mega).
