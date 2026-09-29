---
name: gpio-3d
description: >-
  Write printable parts for the current GitHub project. Use when the user
  wants a 3D-printed clip, spacer, shroud, or other part that fits the
  companion header and/or an Arduino Uno, Nano, or Mega. Run the gpio-3d
  command. Output ~/projects/<repo>/model/ as one glTF (.glb) and one STL
  per part, plus model/manifest.json. Meshes come from trimesh, not tscircuit.
---

# gpio-3d

Write printable parts the project can show (`.glb`) and slice (`.stl`). Do **not** use tscircuit for meshes (tscircuit is for `pcb/`). Do **not** invent a CAD kernel, hand-write glTF/STL bytes, or `import trimesh`.

## Tool

Run `gpio-3d`. It writes meshes with [trimesh](https://github.com/mikedh/trimesh) and sets manifest `tool` to `trimesh`. Coordinates are **millimeters**. Pitch is **2.54 mm**. Do not pass a pitch and do not scale to meters.

You run the command yourself. **Never** `pip install`. **Never** tell the user to pip-install, and **never** tell them to curl loopback.

If `gpio-3d` is not on PATH, stop. Tell the user to **Update companion**. Do not install trimesh yourself.

```sh
gpio-3d clip --name header-clip --cols 20 --rows 2 --thickness 2 --fits companion-header --dir ~/projects/<repo>/model
gpio-3d spacer --name header-spacer --cols 8 --rows 1 --height 3 --hole 1.0 --fits arduino-uno --dir ~/projects/<repo>/model
gpio-3d shroud --name header-shroud --cols 20 --rows 2 --height 8 --wall 1.6 --fits companion-header --dir ~/projects/<repo>/model
```

`--cols` and `--rows` size the part: length is `cols × 2.54`, width is `rows × 2.54`. Repeat `--fits` when the same geometry fits more than one board. `--hole` must be under 2.54 mm.

Use `clip`, `spacer`, or `shroud` first. Use `build` only when those three cannot express the part. The recipe is stdin, not a file in `model/`:

```sh
gpio-3d build - --dir ~/projects/<repo>/model <<'EOF'
{
  "name": "notched-clip",
  "units": "mm",
  "fits": ["companion-header"],
  "ops": [
    {"op": "header-bar", "cols": 8, "rows": 2, "thickness": 2},
    {"op": "cut", "shape": "box", "size": [2.54, 2.54, 2], "at": [1.27, 1.27, 1]}
  ]
}
EOF
```

Recipe ops are `box`, `cylinder`, `header-bar`, `hole-grid`, and `cut` (`shape` `box` or `cylinder`). `header-bar` and `hole-grid` sit on the 2.54 mm grid from the origin. Do not add `pitch`, a file path, or any other field. `units` is `mm` only.

## Which board

Before choosing `fits`, see whether a USB Arduino is the live board:

```sh
curl -s http://127.0.0.1:4150/v1/arduino-proxy
```

You call loopback yourself. **Never** tell the user to curl it.

If `connected` is true and the user did not ask for the companion header, fit the USB board from `fqbn`: `arduino-uno`, `arduino-nano`, or `arduino-mega`. Otherwise fit `companion-header`. Load `gpio-pinout-raspberrypi` or `gpio-pinout-orangepi` and size to that header (40-pin Raspberry Pi layout, or the shorter Orange Pi header). A part may list more than one board when the same 2.54 mm geometry fits each of them. Do not invent other board ids.

## Output

One branch may hold every part that belongs together. A later part is another `gpio-3d` call in that checkout's `model/`. The command keeps other names. It replaces a part only when `--name` matches. Do not delete another part unless the user names it.

If you are on `main`, branch once (`feat/<kebab>`) before writing. If you are already on a feature branch for this work, stay there unless this model needs its own branch. You may `git checkout -b feat/<kebab>` when you decide a part should not share the current branch. Push that branch. Do not force the user onto one branch, and do not open a branch only because a second file exists.

When the parts for this slice are written, commit on that branch, `git push`, then ask if the user wants to save to `main` (skill `gpio-companion` **Project git**). Merge `main` only when they say yes.

Directory: `~/projects/<repo>/model/`

- `model/<part>.glb` — one glTF binary per part (viewer)
- `model/<part>.stl` — same stem (print)
- `model/manifest.json` — one file for every part; `gpio-3d` writes it

No other files in `model/`. Do not put the recipe there.

## manifest.json

`gpio-3d` writes this. Do not hand-edit it unless a command failed and you are fixing `fits` only.

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
- `file` is one basename, kebab-case, ending in `.glb`. The print file is that stem with `.stl`. The command names the file from `--name`.
- `fits` is one or more of `companion-header`, `arduino-uno`, `arduino-nano`, `arduino-mega`.
- `name` is unique. `file` is unique. Each `.glb` contains one mesh. Several parts may share one `model/` on one branch. A new `feat/` branch is allowed when you decide the model needs one.
- Pitch is 2.54 mm. Size from the loaded pinout. Do not guess unpublished hole coordinates.
- Companion header is 3.3 V. Do not design a part that ties header 5 V into a GPIO.
- Validate before commit. The script sits next to this skill (repo `opencode/skills/gpio-3d/`, on device `~/.config/opencode/skills/gpio-3d/`):

```sh
bun ~/.config/opencode/skills/gpio-3d/validate-manifest.ts ~/projects/<repo>/model
```

Then `git add model/`, commit, `git push` the feature branch. Do not merge `main` until the user asks to save.

## Sample

`sample/model/` in this skill is a valid manifest, written with `gpio-3d clip`: a 50.8 × 5.08 × 2.0 mm clip for a 40-pin companion header (20 × 2.54 mm) and a 20.32 × 2.54 × 2.0 mm clip for an 8-pin Arduino header (Uno, Nano, and Mega).
