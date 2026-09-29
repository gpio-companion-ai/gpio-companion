import json
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


if __name__ == "__main__":
    unittest.main()
