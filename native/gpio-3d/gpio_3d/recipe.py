import json
import sys
from pathlib import Path

from gpio_3d.constants import UNITS
from gpio_3d.errors import Gpio3dError
from gpio_3d.export import part_fits, part_name
from gpio_3d.mesh import apply_ops


def load_recipe(source, directory):
    if source == "-":
        raw = sys.stdin.read()
    else:
        path = Path(source)
        if not path.is_file():
            raise Gpio3dError(f"missing {path}")
        try:
            if path.resolve().is_relative_to(directory.resolve()):
                raise Gpio3dError("recipe must not be inside the model directory")
        except ValueError as exc:
            raise Gpio3dError("recipe path is not valid") from exc
        raw = path.read_text()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise Gpio3dError("recipe is not valid JSON") from exc
    if not isinstance(data, dict):
        raise Gpio3dError("recipe must be an object")
    allowed = {"name", "fits", "units", "ops"}
    for key in data:
        if key not in allowed:
            raise Gpio3dError(f"recipe has unknown field {key}")
    if data.get("units") != UNITS:
        raise Gpio3dError("recipe units must be mm")
    name = part_name(data.get("name"))
    fits = part_fits(data.get("fits"))
    ops = data.get("ops")
    if not isinstance(ops, list) or len(ops) == 0:
        raise Gpio3dError("recipe needs ops")
    parsed = []
    for index, op in enumerate(ops):
        if not isinstance(op, dict) or not isinstance(op.get("op"), str):
            raise Gpio3dError(f"ops[{index}] must be an object with op")
        parsed.append(op)
    return name, fits, apply_ops(parsed)
