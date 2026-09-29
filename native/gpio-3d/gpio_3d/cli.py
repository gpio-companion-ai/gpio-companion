import argparse
import sys

from gpio_3d.errors import Gpio3dError
from gpio_3d.export import model_dir, write_part
from gpio_3d.mesh import clip_mesh, shroud_mesh, spacer_mesh
from gpio_3d.recipe import load_recipe


def main(argv=None):
    parser = argparse.ArgumentParser(prog="gpio-3d")
    sub = parser.add_subparsers(dest="command", required=True)

    clip = sub.add_parser("clip")
    add_header(clip)
    clip.add_argument("--thickness", required=True, type=float)
    clip.set_defaults(func=run_clip)

    spacer = sub.add_parser("spacer")
    add_header(spacer)
    spacer.add_argument("--height", required=True, type=float)
    spacer.add_argument("--hole", required=True, type=float)
    spacer.set_defaults(func=run_spacer)

    shroud = sub.add_parser("shroud")
    add_header(shroud)
    shroud.add_argument("--height", required=True, type=float)
    shroud.add_argument("--wall", required=True, type=float)
    shroud.set_defaults(func=run_shroud)

    build = sub.add_parser("build")
    build.add_argument("recipe")
    build.add_argument("--dir", required=True)
    build.set_defaults(func=run_build)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except Gpio3dError as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


def add_header(parser):
    parser.add_argument("--name", required=True)
    parser.add_argument("--cols", required=True, type=int)
    parser.add_argument("--rows", required=True, type=int)
    parser.add_argument("--fits", action="append", required=True)
    parser.add_argument("--dir", required=True)


def run_clip(args):
    write_part(clip_mesh(args.cols, args.rows, args.thickness), args.name, args.fits, args.dir)


def run_spacer(args):
    write_part(
        spacer_mesh(args.cols, args.rows, args.height, args.hole),
        args.name,
        args.fits,
        args.dir,
    )


def run_shroud(args):
    write_part(
        shroud_mesh(args.cols, args.rows, args.height, args.wall),
        args.name,
        args.fits,
        args.dir,
    )


def run_build(args):
    directory = model_dir(args.dir)
    name, fits, mesh = load_recipe(args.recipe, directory)
    write_part(mesh, name, fits, directory)
