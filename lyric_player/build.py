"""Copy validated public content into a clean build directory."""

import hashlib
import json
import shutil
from pathlib import Path

from .schema import asset, validate

PROJECT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(source=Path("data/songs"), output=Path("build")):
    output = output.resolve()
    source = source.resolve()
    if (
        output == PROJECT
        or output == source
        or output in source.parents
        or source in output.parents
    ):
        raise ValueError("Build output must be separate from the project and source directories")
    # Never recursively delete a user-selected directory. Replace known build files only.
    output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(PROJECT / "web", output, dirs_exist_ok=True)
    songs, manifests, ids = [], {}, set()
    for path in sorted(source.glob("*/song.json")):
        song = validate(json.loads(path.read_text("utf-8")), path.parent)
        if song["id"] in ids:
            raise ValueError(f"Duplicate song id: {song['id']}")
        ids.add(song["id"])
        copied = {}

        def copy(name):
            if name not in copied:
                original = asset(path.parent, name)
                with original.open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()[:20]
                target = f"assets/{digest}{original.suffix.lower()}"
                destination = output / target
                destination.parent.mkdir(exist_ok=True)
                if not destination.exists():
                    shutil.copyfile(original, destination)
                copied[name] = target
            return copied[name]

        for variant in song["audio"].values():
            variant["src"] = copy(variant["src"])
        for line in song["lines"]:
            for voice in line.get("narration", {}).values():
                voice["src"] = copy(voice["src"])
        for name, manifest in song.pop("chunks", {}).items():
            for chunk in manifest["chunks"]:
                if "parts" in chunk:
                    chunk["parts"] = [copy(part) for part in chunk["parts"]]
                    chunk["src"] = chunk["parts"][0]
                else:
                    chunk["src"] = copy(chunk["src"])
            manifests[copy(name)] = manifest
        # Production clients need display data, not source URLs, model logs or review notes.
        public = {
            k: song[k]
            for k in ("schemaVersion", "id", "title", "artist", "duration", "audio", "lines")
        }
        public["lines"] = [
            {
                **{
                    key: line[key]
                    for key in (
                        "id",
                        "jp",
                        "translation",
                        "section",
                        "start",
                        "end",
                        "clipStart",
                        "clipEnd",
                        "narration",
                    )
                    if key in line
                },
                "tokens": [
                    {
                        key: token[key]
                        for key in ("jp", "kana", "romaji", "start", "end", "ruby", "readingParts")
                        if key in token
                    }
                    for token in line["tokens"]
                ],
            }
            for line in song["lines"]
        ]
        songs.append(public)
    if not songs:
        raise ValueError("No song.json found. Run python -m lyric_player demo first.")
    write_json(output / "library.json", {"schemaVersion": 1, "songs": songs, "chunks": manifests})
    print(f"Built {len(songs)} songs in {output}")
