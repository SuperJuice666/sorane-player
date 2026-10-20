"""Build the public demo from a versioned song package."""

import argparse
import hashlib
import json
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from .build import PROJECT, build


def unpack(archive, destination, expected):
    with archive.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError("Demo package checksum differs from the configured release")
    with zipfile.ZipFile(archive) as source:
        for item in source.infolist():
            path = PurePosixPath(item.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in item.filename:
                raise ValueError("Demo package contains an invalid path")
            if not path.parts or path.parts[0] != "songs":
                raise ValueError("Demo package must contain a songs directory")
        source.extractall(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=PROJECT / "examples/demo-site.json")
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path("build"))
    args = parser.parse_args()
    config = json.loads(args.config.read_text("utf-8"))
    with tempfile.TemporaryDirectory(prefix="sorane-demo-") as directory:
        root = Path(directory)
        archive = args.archive
        if archive is None:
            archive = root / "package.zip"
            request = urllib.request.Request(config["url"], headers={"User-Agent": "SoranePlayer"})
            with (
                urllib.request.urlopen(request, timeout=180) as response,
                archive.open("wb") as out,
            ):
                shutil.copyfileobj(response, out)
        unpack(archive, root / "content", config["sha256"])
        build(root / "content/songs", args.output)
        (args.output / ".nojekyll").touch()


if __name__ == "__main__":
    main()
