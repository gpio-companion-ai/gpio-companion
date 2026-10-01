---
name: gpio-3d
description: >-
  Write printable parts for the current GitHub project. Use when the user
  wants a 3D-printed clip, spacer, shroud, bracket, knob, or other part —
  simple or complex — that fits the companion header and/or an Arduino
  Uno, Nano, or Mega. Run the gpio-3d command. Output
  ~/projects/<repo>/model/ as one glTF (.glb) and one STL per part, plus
  model/manifest.json. Meshes come from trimesh, not tscircuit.
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

The presets also take an optional `--color #rrggbb`.

`--cols` and `--rows` size the part: length is `cols × 2.54`, width is `rows × 2.54`. Repeat `--fits` when the same geometry fits more than one board. `--hole` must be under 2.54 mm.

Use `clip`, `spacer`, or `shroud` first. Use `build` when those three cannot express the part — brackets, knobs, rings, combs, engraved labels, anything else. The recipe is stdin, not a file in `model/`:

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

## Recipe ops

`units` is `mm` only. Every solid op accepts `at` (`[x, y, z]`, the solid's center) and `rotate` (`[degX, degY, degZ]`, spins the solid about its own center). A recipe has at most 100 ops total.

The recipe may also set `color`: a `#rrggbb` hex string that tints the part in the 3D viewer only. It never changes the printable STL — pick a color that makes the part easy to tell apart on screen, not for printing. The presets set it with `--color`.

Solids (the first one starts the part; later ones union onto it):

- `box` — `size: [x, y, z]`. Without `at`, the minimum corner sits at the origin.
- `cylinder` — `radius`, `height`; optional `axis` (`x`, `y`, or `z`, default `z`). Without `at`, the base sits on the floor.
- `header-bar` — `cols`, `rows`, `thickness`; sits on the 2.54 mm grid from the origin.
- `sphere` — `radius`, centered at the origin unless `at`.
- `torus` — `radius` (ring) and `tube` (`tube` < `radius`); lies flat, hole along z.
- `cone` — `radius`, `height`; base on the floor, apex up.
- `capsule` — `radius`, `height`; `height` is the overall length including both rounded ends, so it must be at least `2 × radius`; stands on the floor along z.
- `revolve` — `profile: [[radius, height], ...]` spun around the z axis; start and end the profile at radius `0` for a closed solid (a closed loop makes a ring). Optional `angle` (degrees, `0`–`360`) leaves a flat side.
- `extrude` — `points: [[x, y], ...]` (3–200 points), optional `holes` (up to 20 rings of the same shape), `height`. Optional `twist` (degrees) and `taper` (top scale, `0`–`10`).

Modifiers:

- `cut` — `shape` plus that solid's fields; subtracts it. Any solid works as a shape, so `{"op": "cut", "shape": "cylinder", "radius": 2, "height": 10, "axis": "x", "at": [5, 5, 1]}` drills a sideways hole.
- `intersect` — same fields as `cut`; keeps only the overlap. Needs a part first.
- `hole-grid` — `cols`, `rows`, `diameter` (under 2.54 mm); punches the pin grid from the origin.
- `pattern` — `count` (2–200) and `ops` (a list of solid ops only); repeats the group. Linear: `axis` (`x`, `y`, `z`) plus `step` (mm). Polar: `around: [x, y]` plus `degrees` per copy. Default `mode` is `add`; `"mode": "cut"` subtracts every copy instead (vent grids, slots).
- `mirror` — `axis` (`x`, `y`, or `z`) and `ops` (solid ops only); adds the group plus its flip across that axis's plane through the origin. Build one half touching the origin, mirror the other. Also accepts `"mode": "cut"`.
- `text` — `value` (1–40 characters, one line), `size` (mm cap height), `depth` (mm), and `at` (required). `mode` is `engrave` (default; `at` is the face and the text cuts `depth` below it) or `emboss` (`at` is the base and the text grows `depth` above it). Optional `align` (`left`, `center`, `right` — where `at` sits in x) and `bold`. DejaVu Sans is built in; accents work. Use one `text` op per part.

Pitch is 2.54 mm. Do not add `pitch`, a file path, or any other field. Do not nest `pattern` or `mirror` inside another `pattern` or `mirror`; one level only.

A knurled knob with an engraved label:

```sh
gpio-3d build - --dir ~/projects/<repo>/model <<'EOF'
{
  "name": "knob",
  "units": "mm",
  "fits": ["companion-header"],
  "color": "#22cc88",
  "ops": [
    {"op": "revolve", "profile": [[0, 0], [9, 0], [9, 2], [4, 2], [4, 8], [0, 8]]},
    {"op": "pattern", "count": 12, "around": [0, 0], "degrees": 30, "ops": [{"op": "box", "size": [1.6, 3, 6], "at": [4.2, 0, 4]}]},
    {"op": "cut", "shape": "box", "size": [1.6, 3.4, 3], "at": [9, 0, 1]},
    {"op": "text", "value": "CH1", "size": 3, "depth": 0.8, "at": [0, 0, 8], "align": "center"}
  ]
}
EOF
```

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
      "fits": ["companion-header"],
      "color": "#22cc88"
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
- `color` is optional, `#rrggbb`, viewer tint only.
- `name` is unique. `file` is unique. Each `.glb` contains one mesh. Several parts may share one `model/` on one branch. A new `feat/` branch is allowed when you decide the model needs one.
- Pitch is 2.54 mm. Size from the loaded pinout. Do not guess unpublished hole coordinates.
- Companion header is 3.3 V. Do not design a part that ties header 5 V into a GPIO.
- Validate before commit. The script sits next to this skill (repo `opencode/skills/gpio-3d/`, on device `~/.config/opencode/skills/gpio-3d/`):

```sh
bun ~/.config/opencode/skills/gpio-3d/validate-manifest.ts ~/projects/<repo>/model
```

Then `git add model/`, commit, `git push` the feature branch. Do not merge `main` until the user asks to save.

## Sample

`sample/model/` in this skill is a valid manifest: `header-clip` and `arduino-header-clip` written with `gpio-3d clip`, plus `engraved-clip` written with `gpio-3d build` (a `header-bar` with a pin-slot `pattern` cut and an engraved `GPIO` label).
