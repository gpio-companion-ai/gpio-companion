import math

import trimesh

from gpio_3d.constants import MAX_COLS, MAX_MM, MAX_ROWS, PITCH_MM
from gpio_3d.errors import Gpio3dError


def count(value, label, limit):
    if isinstance(value, bool):
        raise Gpio3dError(f"{label} must be an integer from 1 to {limit}")
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if not isinstance(value, int) or value < 1 or value > limit:
        raise Gpio3dError(f"{label} must be an integer from 1 to {limit}")
    return value


def mm(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Gpio3dError(f"{label} must be a number of millimeters")
    number = float(value)
    if not math.isfinite(number) or number <= 0 or number > MAX_MM:
        raise Gpio3dError(f"{label} must be between 0 and {MAX_MM:g} mm")
    return number


def size3(value, label):
    if not isinstance(value, list) or len(value) != 3:
        raise Gpio3dError(f"{label} must be [x, y, z] millimeters")
    return (mm(value[0], f"{label}[0]"), mm(value[1], f"{label}[1]"), mm(value[2], f"{label}[2]"))


def center3(value, label):
    if value is None:
        return (0.0, 0.0, 0.0)
    if not isinstance(value, list) or len(value) != 3:
        raise Gpio3dError(f"{label} must be [x, y, z] millimeters")
    point = []
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise Gpio3dError(f"{label}[{index}] must be a number")
        number = float(item)
        if not math.isfinite(number) or abs(number) > MAX_MM:
            raise Gpio3dError(f"{label}[{index}] is out of range")
        point.append(number)
    return (point[0], point[1], point[2])


def header_size(cols, rows, thickness):
    return (cols * PITCH_MM, rows * PITCH_MM, thickness)


def box_from_min(size):
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation((size[0] / 2, size[1] / 2, size[2] / 2))
    return mesh


def cylinder_at(radius, height, center):
    mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=32)
    mesh.apply_translation(center)
    return mesh


def pin_centers(cols, rows):
    centers = []
    for row in range(rows):
        for col in range(cols):
            centers.append(((col + 0.5) * PITCH_MM, (row + 0.5) * PITCH_MM))
    return centers


def require_manifold():
    try:
        __import__("manifold3d")
    except ImportError as exc:
        raise Gpio3dError("manifold3d is not installed; Update companion") from exc


def as_mesh(result, label):
    if isinstance(result, list):
        if len(result) != 1:
            raise Gpio3dError(f"{label} did not produce one mesh")
        result = result[0]
    if not isinstance(result, trimesh.Trimesh) or len(result.faces) == 0:
        raise Gpio3dError(f"{label} did not produce one mesh")
    return result


def subtract(mesh, cuts, label):
    require_manifold()
    tool = cuts[0] if len(cuts) == 1 else trimesh.util.concatenate(cuts)
    try:
        result = trimesh.boolean.difference([mesh, tool], engine="manifold")
    except Exception as exc:
        raise Gpio3dError(f"{label} failed") from exc
    return as_mesh(result, label)


def unite(mesh, other, label):
    require_manifold()
    try:
        result = trimesh.boolean.union([mesh, other], engine="manifold")
    except Exception as exc:
        raise Gpio3dError(f"{label} failed") from exc
    return as_mesh(result, label)


def clip_mesh(cols, rows, thickness):
    cols = count(cols, "cols", MAX_COLS)
    rows = count(rows, "rows", MAX_ROWS)
    thickness = mm(thickness, "thickness")
    return box_from_min(header_size(cols, rows, thickness))


def spacer_mesh(cols, rows, height, hole):
    cols = count(cols, "cols", MAX_COLS)
    rows = count(rows, "rows", MAX_ROWS)
    height = mm(height, "height")
    hole = mm(hole, "hole")
    if hole >= PITCH_MM:
        raise Gpio3dError(f"hole must be under {PITCH_MM:g} mm")
    plate = box_from_min(header_size(cols, rows, height))
    return punch(plate, cols, rows, hole, "spacer")


def shroud_mesh(cols, rows, height, wall):
    cols = count(cols, "cols", MAX_COLS)
    rows = count(rows, "rows", MAX_ROWS)
    height = mm(height, "height")
    wall = mm(wall, "wall")
    if height <= wall:
        raise Gpio3dError("height must be greater than wall")
    outer = box_from_min((cols * PITCH_MM + 2 * wall, rows * PITCH_MM + 2 * wall, height))
    inner = box_from_min((cols * PITCH_MM, rows * PITCH_MM, height))
    inner.apply_translation((wall, wall, wall))
    return subtract(outer, [inner], "shroud")


def punch(mesh, cols, rows, diameter, label):
    if diameter >= PITCH_MM:
        raise Gpio3dError(f"diameter must be under {PITCH_MM:g} mm")
    low = float(mesh.bounds[0][2])
    high = float(mesh.bounds[1][2])
    span = high - low + 0.4
    center_z = (low + high) / 2
    cuts = [
        cylinder_at(diameter / 2, span, (x, y, center_z))
        for x, y in pin_centers(cols, rows)
    ]
    return subtract(mesh, cuts, label)


def apply_ops(ops):
    mesh = None
    for index, op in enumerate(ops):
        mesh = apply_op(mesh, op, index)
    if mesh is None:
        raise Gpio3dError("recipe needs a box, cylinder, or header-bar")
    return mesh


def apply_op(mesh, op, index):
    kind = op.get("op")
    label = f"ops[{index}]"
    if kind in {"box", "cylinder", "header-bar"}:
        solid = additive(op, label)
        return solid if mesh is None else unite(mesh, solid, label)
    if mesh is None:
        raise Gpio3dError(f"{label} needs a mesh first")
    if kind == "hole-grid":
        reject(op, {"op", "cols", "rows", "diameter"}, label)
        cols = count(op.get("cols"), f"{label}.cols", MAX_COLS)
        rows = count(op.get("rows"), f"{label}.rows", MAX_ROWS)
        diameter = mm(op.get("diameter"), f"{label}.diameter")
        return punch(mesh, cols, rows, diameter, label)
    if kind == "cut":
        return cut(mesh, op, label)
    raise Gpio3dError(f"{label}.op must be box, cylinder, header-bar, hole-grid, or cut")


def additive(op, label):
    kind = op.get("op")
    if kind == "box":
        reject(op, {"op", "size", "at"}, label)
        size = size3(op.get("size"), f"{label}.size")
        solid = box_from_min(size)
        if "at" in op:
            move_center(solid, center3(op.get("at"), f"{label}.at"))
        return solid
    if kind == "cylinder":
        reject(op, {"op", "radius", "height", "at"}, label)
        radius = mm(op.get("radius"), f"{label}.radius")
        height = mm(op.get("height"), f"{label}.height")
        if "at" in op:
            return cylinder_at(radius, height, center3(op.get("at"), f"{label}.at"))
        return cylinder_at(radius, height, (0.0, 0.0, height / 2))
    if kind == "header-bar":
        reject(op, {"op", "cols", "rows", "thickness"}, label)
        return clip_mesh(op.get("cols"), op.get("rows"), op.get("thickness"))
    raise Gpio3dError(f"{label}.op must be box, cylinder, header-bar, hole-grid, or cut")


def cut(mesh, op, label):
    shape = op.get("shape")
    if shape == "box":
        reject(op, {"op", "shape", "size", "at"}, label)
        solid = box_from_min(size3(op.get("size"), f"{label}.size"))
        move_center(solid, center3(op.get("at"), f"{label}.at"))
        return subtract(mesh, [solid], label)
    if shape == "cylinder":
        reject(op, {"op", "shape", "radius", "height", "at"}, label)
        radius = mm(op.get("radius"), f"{label}.radius")
        height = mm(op.get("height"), f"{label}.height")
        if "at" in op:
            center = center3(op.get("at"), f"{label}.at")
        else:
            center = (0.0, 0.0, height / 2)
        return subtract(mesh, [cylinder_at(radius, height, center)], label)
    raise Gpio3dError(f"{label}.shape must be box or cylinder")


def move_center(mesh, at):
    center = mesh.bounds.mean(axis=0)
    mesh.apply_translation((at[0] - center[0], at[1] - center[1], at[2] - center[2]))


def reject(op, allowed, label):
    for key in op:
        if key not in allowed:
            raise Gpio3dError(f"{label} has unknown field {key}")
