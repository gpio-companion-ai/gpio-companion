import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from gpio_3d.errors import Gpio3dError
from gpio_3d.mesh import apply_ops, clip_mesh, shroud_mesh, spacer_mesh


def run_cli(args, cwd):
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(
        [sys.executable, "-m", "gpio_3d", *args],
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


class MeshTest(unittest.TestCase):
    def test_clip_is_a_header_bar(self):
        mesh = clip_mesh(20, 2, 2)
        self.assertAlmostEqual(mesh.extents[0], 50.8, places=6)
        self.assertAlmostEqual(mesh.extents[1], 5.08, places=6)
        self.assertAlmostEqual(mesh.extents[2], 2.0, places=6)
        self.assertAlmostEqual(float(mesh.bounds[0][0]), 0.0, places=6)

    def test_spacer_removes_pin_holes(self):
        mesh = spacer_mesh(2, 2, 5, 1.0)
        plate = 2 * 2.54 * 2 * 2.54 * 5
        holes = 4 * 3.141592653589793 * 0.5 * 0.5 * 5
        self.assertAlmostEqual(mesh.volume, plate - holes, delta=1.0)
        self.assertLess(mesh.volume, plate)

    def test_spacer_rejects_a_hole_wider_than_the_pitch(self):
        with self.assertRaises(Gpio3dError):
            spacer_mesh(2, 2, 5, 3.2)

    def test_shroud_has_a_floor_and_an_open_cavity(self):
        mesh = shroud_mesh(4, 2, 8, 1.6)
        outer = (4 * 2.54 + 3.2) * (2 * 2.54 + 3.2) * 8
        cavity = (4 * 2.54) * (2 * 2.54) * (8 - 1.6)
        self.assertAlmostEqual(mesh.extents[0], 4 * 2.54 + 3.2, delta=0.05)
        self.assertAlmostEqual(mesh.volume, outer - cavity, delta=2.0)
        self.assertLess(mesh.volume, outer * 0.8)

    def test_recipe_rejects_inches_and_unknown_ops(self):
        with self.assertRaises(Gpio3dError):
            apply_ops([{"op": "glb", "file": "part.glb"}])
        with self.assertRaises(Gpio3dError):
            apply_ops([{"op": "header-bar", "cols": 2, "rows": 1, "thickness": 2, "pitch": 2.5}])


class RecipeOpsTest(unittest.TestCase):
    def test_sideways_cylinder_cuts_a_through_hole(self):
        mesh = apply_ops(
            [
                {"op": "box", "size": [20, 10, 4]},
                {"op": "cut", "shape": "cylinder", "radius": 1.5, "height": 30, "axis": "x", "at": [10, 5, 2]},
            ]
        )
        self.assertTrue(mesh.is_watertight)
        self.assertAlmostEqual(mesh.volume, 800 - math.pi * 1.5 * 1.5 * 20, delta=6.0)

    def test_rotated_cut_changes_the_solid(self):
        straight = apply_ops(
            [
                {"op": "box", "size": [10, 10, 2]},
                {"op": "cut", "shape": "box", "size": [14, 1, 4], "at": [5, 5, 1]},
            ]
        )
        angled = apply_ops(
            [
                {"op": "box", "size": [10, 10, 2]},
                {"op": "cut", "shape": "box", "size": [14, 1, 4], "at": [5, 5, 1], "rotate": [0, 0, 45]},
            ]
        )
        self.assertTrue(angled.is_watertight)
        self.assertGreater(straight.volume - angled.volume, 2.0)

    def test_extrude_supports_holes_twist_and_taper(self):
        plain = apply_ops(
            [
                {
                    "op": "extrude",
                    "points": [[0, 0], [10, 0], [10, 10], [0, 10]],
                    "holes": [[[4, 4], [6, 4], [6, 6], [4, 6]]],
                    "height": 3,
                }
            ]
        )
        self.assertTrue(plain.is_watertight)
        self.assertAlmostEqual(plain.volume, (100 - 4) * 3, delta=3.0)
        twisted = apply_ops(
            [
                {
                    "op": "extrude",
                    "points": [[0, 0], [10, 0], [10, 10], [0, 10]],
                    "height": 3,
                    "twist": 90,
                }
            ]
        )
        self.assertTrue(twisted.is_watertight)
        tapered = apply_ops(
            [
                {
                    "op": "extrude",
                    "points": [[0, 0], [10, 0], [10, 10], [0, 10]],
                    "height": 3,
                    "taper": 0.5,
                }
            ]
        )
        self.assertTrue(tapered.is_watertight)
        self.assertLess(tapered.volume, plain.volume)

    def test_new_primitives_have_expected_volumes(self):
        sphere = apply_ops([{"op": "sphere", "radius": 3}])
        self.assertAlmostEqual(sphere.volume, 4 / 3 * math.pi * 27, delta=4.0)
        cone = apply_ops([{"op": "cone", "radius": 3, "height": 5}])
        self.assertAlmostEqual(cone.volume, math.pi * 9 * 5 / 3, delta=2.0)
        torus = apply_ops([{"op": "torus", "radius": 5, "tube": 1}])
        self.assertAlmostEqual(torus.volume, 2 * math.pi * math.pi * 5, delta=4.0)
        capsule = apply_ops([{"op": "capsule", "radius": 1, "height": 6}])
        self.assertAlmostEqual(capsule.extents[2], 6.0, delta=0.1)
        self.assertAlmostEqual(capsule.extents[0], 2.0, delta=0.1)
        with self.assertRaises(Gpio3dError):
            apply_ops([{"op": "torus", "radius": 1, "tube": 2}])
        with self.assertRaises(Gpio3dError):
            apply_ops([{"op": "capsule", "radius": 2, "height": 3}])

    def test_revolve_builds_a_vase(self):
        mesh = apply_ops(
            [{"op": "revolve", "profile": [[0, 0], [3, 0], [3, 6], [1, 6], [1, 10], [0, 10]]}]
        )
        self.assertTrue(mesh.is_watertight)
        self.assertAlmostEqual(mesh.volume, math.pi * 9 * 6 + math.pi * 1 * 4, delta=6.0)
        partial = apply_ops(
            [{"op": "revolve", "profile": [[0, 0], [3, 0], [3, 6], [0, 6]], "angle": 180}]
        )
        self.assertTrue(partial.is_watertight)
        self.assertLess(partial.volume, math.pi * 9 * 6)

    def test_pattern_cuts_a_vent_grid(self):
        mesh = apply_ops(
            [
                {"op": "box", "size": [20, 10, 2]},
                {
                    "op": "pattern",
                    "mode": "cut",
                    "count": 4,
                    "axis": "x",
                    "step": 4,
                    "ops": [{"op": "cylinder", "radius": 1, "height": 4, "at": [4, 5, 1]}],
                },
            ]
        )
        self.assertTrue(mesh.is_watertight)
        self.assertAlmostEqual(mesh.volume, 400 - 4 * math.pi * 2, delta=3.0)

    def test_pattern_places_polar_copies_and_rejects_bad_specs(self):
        mesh = apply_ops(
            [
                {"op": "cylinder", "radius": 5, "height": 2},
                {
                    "op": "pattern",
                    "count": 6,
                    "around": [0, 0],
                    "degrees": 60,
                    "ops": [{"op": "sphere", "radius": 1, "at": [8, 0, 1]}],
                },
            ]
        )
        self.assertTrue(mesh.is_watertight)
        self.assertAlmostEqual(mesh.volume, math.pi * 25 * 2 + 6 * 4 / 3 * math.pi, delta=6.0)
        with self.assertRaises(Gpio3dError):
            apply_ops(
                [
                    {"op": "box", "size": [10, 10, 2]},
                    {"op": "pattern", "count": 1, "axis": "x", "step": 2, "ops": [{"op": "sphere", "radius": 1}]},
                ]
            )
        with self.assertRaises(Gpio3dError):
            apply_ops(
                [
                    {"op": "box", "size": [10, 10, 2]},
                    {"op": "pattern", "count": 2, "axis": "x", "step": 2, "ops": [{"op": "cut", "shape": "box", "size": [1, 1, 1]}]},
                ]
            )
        with self.assertRaises(Gpio3dError):
            apply_ops(
                [
                    {"op": "box", "size": [10, 10, 2]},
                    {"op": "pattern", "count": 3, "axis": "x", "step": 2, "around": [0, 0], "degrees": 30, "ops": [{"op": "sphere", "radius": 1}]},
                ]
            )

    def test_mirror_builds_symmetric_halves(self):
        mesh = apply_ops(
            [{"op": "mirror", "axis": "x", "ops": [{"op": "box", "size": [3, 4, 2], "at": [1.5, 0, 1]}]}]
        )
        self.assertTrue(mesh.is_watertight)
        self.assertAlmostEqual(mesh.bounds[0][0], -3.0, places=3)
        self.assertAlmostEqual(mesh.bounds[1][0], 3.0, places=3)
        self.assertAlmostEqual(mesh.volume, 48.0, delta=0.5)

    def test_intersect_keeps_the_overlap(self):
        mesh = apply_ops(
            [
                {"op": "box", "size": [10, 10, 2]},
                {"op": "intersect", "shape": "sphere", "radius": 5, "at": [5, 5, 1]},
            ]
        )
        self.assertTrue(mesh.is_watertight)
        self.assertGreater(mesh.volume, 0)
        self.assertLess(mesh.volume, 200)
        with self.assertRaises(Gpio3dError):
            apply_ops([{"op": "intersect", "shape": "sphere", "radius": 5}])

    def test_text_engraves_and_embosses(self):
        engraved = apply_ops(
            [
                {"op": "box", "size": [40, 10, 3]},
                {"op": "text", "value": "HI", "size": 6, "depth": 1, "at": [20, 5, 3]},
            ]
        )
        self.assertTrue(engraved.is_watertight)
        self.assertLess(engraved.volume, 1200)
        embossed = apply_ops(
            [{"op": "text", "value": "A", "size": 8, "depth": 2, "at": [0, 0, 0], "mode": "emboss"}]
        )
        self.assertTrue(embossed.is_watertight)
        self.assertGreater(embossed.volume, 0)
        with self.assertRaises(Gpio3dError):
            apply_ops(
                [
                    {"op": "box", "size": [40, 10, 3]},
                    {"op": "text", "value": "H\u0378", "size": 6, "depth": 1, "at": [20, 5, 3]},
                ]
            )
        with self.assertRaises(Gpio3dError):
            apply_ops(
                [
                    {"op": "box", "size": [40, 10, 3]},
                    {"op": "text", "value": "line\nbreak", "size": 6, "depth": 1, "at": [20, 5, 3]},
                ]
            )
        with self.assertRaises(Gpio3dError):
            apply_ops(
                [
                    {"op": "box", "size": [40, 10, 3]},
                    {"op": "text", "value": "x" * 41, "size": 6, "depth": 1, "at": [20, 5, 3]},
                ]
            )
        accented = apply_ops(
            [
                {"op": "box", "size": [40, 10, 3]},
                {"op": "text", "value": "É", "size": 6, "depth": 1, "at": [20, 5, 3]},
            ]
        )
        self.assertTrue(accented.is_watertight)
        self.assertLess(accented.volume, 1200)

    def test_recipe_caps_total_ops(self):
        nested = [{"op": "sphere", "radius": 1, "at": [i, 0, 0]} for i in range(101)]
        with self.assertRaises(Gpio3dError):
            apply_ops([{"op": "pattern", "count": 2, "axis": "x", "step": 1, "ops": nested}])


class TintTest(unittest.TestCase):
    def test_color_tints_the_viewer_and_the_manifest(self):
        from gpio_3d.export import write_part

        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / "model"
            write_part(clip_mesh(4, 1, 2), "tinted-clip", ["companion-header"], model, "#22CC88")
            manifest = json.loads((model / "manifest.json").read_text())
            self.assertEqual(manifest["parts"][0]["color"], "#22cc88")
            glb = (model / "tinted-clip.glb").read_bytes()
            self.assertIn(b"COLOR_0", glb)
            plain_dir = Path(tmp) / "plain"
            write_part(clip_mesh(4, 1, 2), "plain-clip", ["companion-header"], plain_dir)
            plain = json.loads((plain_dir / "manifest.json").read_text())
            self.assertNotIn("color", plain["parts"][0])
            self.assertNotIn(b"COLOR_0", (plain_dir / "plain-clip.glb").read_bytes())

    def test_color_is_replaced_when_the_same_name_is_rewritten(self):
        from gpio_3d.export import write_part

        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / "model"
            write_part(clip_mesh(4, 1, 2), "part", ["companion-header"], model, "#ff0000")
            write_part(clip_mesh(4, 1, 2), "part", ["companion-header"], model)
            manifest = json.loads((model / "manifest.json").read_text())
            self.assertNotIn("color", manifest["parts"][0])
            self.assertNotIn(b"COLOR_0", (model / "part.glb").read_bytes())

    def test_color_must_be_rrggbb(self):
        from gpio_3d.export import part_color

        self.assertEqual(part_color("#22CC88"), "#22cc88")
        with self.assertRaises(Gpio3dError):
            part_color("22cc88")
        with self.assertRaises(Gpio3dError):
            part_color("#22cc8")
        with self.assertRaises(Gpio3dError):
            part_color("#22cc8g")


class CliTest(unittest.TestCase):
    def test_clip_writes_manifest_and_replaces_the_same_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            model = parent / "model"
            first = run_cli(
                [
                    "clip",
                    "--name",
                    "header-clip",
                    "--cols",
                    "20",
                    "--rows",
                    "2",
                    "--thickness",
                    "2",
                    "--fits",
                    "companion-header",
                    "--dir",
                    str(model),
                ],
                parent,
            )
            self.assertEqual(first.returncode, 0, first.stderr)
            second = run_cli(
                [
                    "clip",
                    "--name",
                    "header-clip",
                    "--cols",
                    "8",
                    "--rows",
                    "1",
                    "--thickness",
                    "2",
                    "--fits",
                    "arduino-uno",
                    "--fits",
                    "arduino-nano",
                    "--dir",
                    str(model),
                ],
                parent,
            )
            self.assertEqual(second.returncode, 0, second.stderr)
            manifest = json.loads((model / "manifest.json").read_text())
            self.assertEqual(manifest["tool"], "trimesh")
            self.assertEqual(manifest["units"], "mm")
            self.assertEqual(len(manifest["parts"]), 1)
            self.assertEqual(manifest["parts"][0]["fits"], ["arduino-uno", "arduino-nano"])
            glb = (model / "header-clip.glb").read_bytes()
            self.assertTrue(glb.startswith(b"glTF"))
            self.assertIn(b"mikedh/trimesh", glb)
            self.assertTrue((model / "header-clip.stl").is_file())
            self.assertEqual(sorted(path.name for path in model.iterdir()), [
                "header-clip.glb",
                "header-clip.stl",
                "manifest.json",
            ])

    def test_a_second_name_stays_on_the_same_branch_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            model = parent / "model"
            first = run_cli(
                [
                    "clip",
                    "--name",
                    "header-clip",
                    "--cols",
                    "20",
                    "--rows",
                    "2",
                    "--thickness",
                    "2",
                    "--fits",
                    "companion-header",
                    "--dir",
                    str(model),
                ],
                parent,
            )
            self.assertEqual(first.returncode, 0, first.stderr)
            second = run_cli(
                [
                    "clip",
                    "--name",
                    "arduino-header-clip",
                    "--cols",
                    "8",
                    "--rows",
                    "1",
                    "--thickness",
                    "2",
                    "--fits",
                    "arduino-uno",
                    "--fits",
                    "arduino-nano",
                    "--fits",
                    "arduino-mega",
                    "--dir",
                    str(model),
                ],
                parent,
            )
            self.assertEqual(second.returncode, 0, second.stderr)
            manifest = json.loads((model / "manifest.json").read_text())
            self.assertEqual(
                [part["name"] for part in manifest["parts"]],
                ["header-clip", "arduino-header-clip"],
            )
            self.assertEqual(
                sorted(path.name for path in model.iterdir()),
                [
                    "arduino-header-clip.glb",
                    "arduino-header-clip.stl",
                    "header-clip.glb",
                    "header-clip.stl",
                    "manifest.json",
                ],
            )

    def test_build_refuses_bad_fits_and_a_recipe_inside_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            model = parent / "model"
            model.mkdir()
            recipe = model / "recipe.json"
            recipe.write_text(
                json.dumps(
                    {
                        "name": "custom-clip",
                        "units": "in",
                        "fits": ["custom-kernel"],
                        "ops": [{"op": "box", "size": [10, 5, 2]}],
                    }
                )
            )
            inside = run_cli(["build", str(recipe), "--dir", str(model)], parent)
            self.assertNotEqual(inside.returncode, 0)
            self.assertIn("model directory", inside.stderr)
            outside = parent / "recipe.json"
            outside.write_text(recipe.read_text())
            bad = run_cli(["build", str(outside), "--dir", str(model)], parent)
            self.assertNotEqual(bad.returncode, 0)
            self.assertIn("mm", bad.stderr)
            outside.write_text(
                json.dumps(
                    {
                        "name": "custom-clip",
                        "units": "mm",
                        "fits": ["companion-header"],
                        "ops": [{"op": "box", "size": [10, 5, 2]}],
                    }
                )
            )
            good = run_cli(["build", "-", "--dir", str(model)], parent)
            # stdin was empty because we did not pass input
            self.assertNotEqual(good.returncode, 0)
            piped = subprocess.run(
                [sys.executable, "-m", "gpio_3d", "build", "-", "--dir", str(model)],
                cwd=parent,
                env={**os.environ, "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1"},
                input=outside.read_text(),
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(piped.returncode, 0, piped.stderr)
            self.assertTrue((model / "custom-clip.glb").is_file())

    def test_cli_accepts_a_color_and_a_colored_recipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            model = parent / "model"
            clip = run_cli(
                [
                    "clip",
                    "--name",
                    "tinted",
                    "--cols",
                    "4",
                    "--rows",
                    "1",
                    "--thickness",
                    "2",
                    "--fits",
                    "companion-header",
                    "--color",
                    "#22CC88",
                    "--dir",
                    str(model),
                ],
                parent,
            )
            self.assertEqual(clip.returncode, 0, clip.stderr)
            manifest = json.loads((model / "manifest.json").read_text())
            self.assertEqual(manifest["parts"][0]["color"], "#22cc88")
            self.assertIn(b"COLOR_0", (model / "tinted.glb").read_bytes())
            recipe = parent / "recipe.json"
            recipe.write_text(
                json.dumps(
                    {
                        "name": "tinted-build",
                        "units": "mm",
                        "fits": ["companion-header"],
                        "color": "#3355ff",
                        "ops": [{"op": "box", "size": [10, 5, 2]}],
                    }
                )
            )
            build = run_cli(["build", str(recipe), "--dir", str(model)], parent)
            self.assertEqual(build.returncode, 0, build.stderr)
            manifest = json.loads((model / "manifest.json").read_text())
            self.assertEqual(manifest["parts"][1]["color"], "#3355ff")
            bad = dict(json.loads(recipe.read_text()))
            bad["name"] = "bad-color"
            bad["color"] = "red"
            recipe.write_text(json.dumps(bad))
            failed = run_cli(["build", str(recipe), "--dir", str(model)], parent)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("color", failed.stderr)

    def test_build_writes_a_complex_recipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            model = parent / "model"
            recipe = parent / "recipe.json"
            recipe.write_text(
                json.dumps(
                    {
                        "name": "labeled-plate",
                        "units": "mm",
                        "fits": ["companion-header"],
                        "ops": [
                            {"op": "box", "size": [40, 10, 3]},
                            {
                                "op": "pattern",
                                "mode": "cut",
                                "count": 4,
                                "axis": "x",
                                "step": 8,
                                "ops": [{"op": "cylinder", "radius": 1.5, "height": 6, "at": [8, 5, 1.5]}],
                            },
                            {"op": "text", "value": "GPIO", "size": 5, "depth": 1, "at": [30, 5, 3]},
                        ],
                    }
                )
            )
            piped = subprocess.run(
                [sys.executable, "-m", "gpio_3d", "build", str(recipe), "--dir", str(model)],
                cwd=parent,
                env={**os.environ, "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1"},
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(piped.returncode, 0, piped.stderr)
            manifest = json.loads((model / "manifest.json").read_text())
            self.assertEqual(manifest["parts"][0]["name"], "labeled-plate")
            glb = (model / "labeled-plate.glb").read_bytes()
            self.assertTrue(glb.startswith(b"glTF"))


if __name__ == "__main__":
    unittest.main()
