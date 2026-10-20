import argparse
import json
from pathlib import Path

from .build import build
from .demo import demo
from .schema import validate


def main():
    parser = argparse.ArgumentParser(description="Build and validate a Sorane music library")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("demo", help="Generate original tones for testing")
    p.add_argument("--output", type=Path, default=Path("data/songs/demo"))
    p = commands.add_parser("build", help="Validate and copy public assets")
    p.add_argument("--songs", type=Path, default=Path("data/songs"))
    p.add_argument("--output", type=Path, default=Path("build"))
    p = commands.add_parser("validate", help="Validate data and referenced files")
    p.add_argument("song", type=Path)
    args = parser.parse_args()
    if args.command == "demo":
        demo(args.output)
    elif args.command == "build":
        build(args.songs, args.output)
    else:
        validate(json.loads(args.song.read_text("utf-8")), args.song.parent)
        print("Valid")


if __name__ == "__main__":
    main()
