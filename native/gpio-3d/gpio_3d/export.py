import json
import re
from pathlib import Path

from gpio_3d.constants import FITS, MANIFEST, NAME, TOOL, UNITS
from gpio_3d.errors import Gpio3dError


def part_name(value):
    if not isinstance(value, str) or not re.fullmatch(NAME, value) or len(value) > 80:
        raise Gpio3dError("name must be kebab-case")
    return value


def part_fits(value):
    if not isinstance(value, list) or len(value) == 0:
        raise Gpio3dError(
            "fits must list companion-header and/or arduino-uno, arduino-nano, arduino-mega"
        )
    fits = []
    for item in value:
        if item not in FITS or item in fits:
            raise Gpio3dError(
                "fits must be companion-header and/or arduino-uno, arduino-nano, arduino-mega"
            )
        fits.append(item)
    return fits


def model_dir(value):
    directory = Path(value)
    if not directory.parent.is_dir():
        raise Gpio3dError(f"missing {directory.parent}")
    directory.mkdir(exist_ok=True)
    if not directory.is_dir():
        raise Gpio3dError(f"{directory} is not a directory")
    return directory


def write_part(mesh, name, fits, directory):
    name = part_name(name)
    fits = part_fits(fits)
    directory = model_dir(directory)
    if len(mesh.faces) == 0:
        raise Gpio3dError("mesh is empty")
    glb_name = f"{name}.glb"
    stl_name = f"{name}.stl"
    glb = mesh.export(file_type="glb")
    stl = mesh.export(file_type="stl")
    if not isinstance(glb, bytes) or not glb.startswith(b"glTF") or b"mikedh/trimesh" not in glb:
        raise Gpio3dError("export did not write a trimesh glb")
    if not isinstance(stl, bytes) or len(stl) < 84:
        raise Gpio3dError("export did not write an stl")
    (directory / glb_name).write_bytes(glb)
    (directory / stl_name).write_bytes(stl)
    upsert_manifest(directory, name, glb_name, fits)
    print(f"{name} {glb_name} {stl_name}")


def upsert_manifest(directory, name, glb_name, fits):
    path = directory / MANIFEST
    manifest = load_manifest(path)
    entry = {"name": name, "file": glb_name, "units": UNITS, "fits": fits}
    parts = manifest["parts"]
    replaced = False
    for index, part in enumerate(parts):
        if isinstance(part, dict) and part.get("name") == name:
            old = part.get("file")
            if isinstance(old, str) and old != glb_name:
                remove_old(directory, old, parts, index)
            parts[index] = entry
            replaced = True
            break
    if not replaced:
        for part in parts:
            if isinstance(part, dict) and part.get("file") == glb_name:
                raise Gpio3dError(f"duplicate part file {glb_name}")
        parts.append(entry)
    path.write_text(json.dumps(manifest, indent="\t") + "\n")


def load_manifest(path):
    if not path.exists():
        return {"version": 1, "units": UNITS, "tool": TOOL, "parts": []}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise Gpio3dError("manifest.json is not valid JSON") from exc
    if (
        not isinstance(data, dict)
        or data.get("version") != 1
        or data.get("units") != UNITS
        or data.get("tool") != TOOL
        or not isinstance(data.get("parts"), list)
    ):
        raise Gpio3dError("manifest.json must be a trimesh mm manifest")
    return data


def remove_old(directory, file, parts, index):
    stem = file[:-4] if file.endswith(".glb") else None
    if stem is None or "/" in file or file.startswith("."):
        return
    used = False
    for other_index, part in enumerate(parts):
        if other_index != index and isinstance(part, dict) and part.get("file") == file:
            used = True
    if used:
        return
    for suffix in (".glb", ".stl"):
        target = directory / f"{stem}{suffix}"
        if target.is_file():
            target.unlink()
