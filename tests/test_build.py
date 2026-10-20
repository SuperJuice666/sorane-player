import json
import tempfile
import unittest
from pathlib import Path

from lyric_player.build import build
from lyric_player.schema import validate


class Build(unittest.TestCase):
    def test_hash_assets_and_strip_private_metadata(self):
        example = json.loads((Path(__file__).parents[1] / "examples/song.json").read_text("utf-8"))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / "songs/demo"
            folder.mkdir(parents=True)
            for variant in example["audio"].values():
                (folder / variant["src"]).write_bytes(b"fixture bytes")
            example["privateNotes"] = "not public"
            example["lines"][0]["privateNotes"] = "not public"
            example["lines"][0]["tokens"][0]["modelTrace"] = "not public"
            (folder / "song.json").write_text(json.dumps(example), encoding="utf-8")
            build(root / "songs", root / "site")
            public = json.loads((root / "site/library.json").read_text("utf-8"))
            validate(public["songs"][0])
            self.assertNotIn("not public", json.dumps(public))
            self.assertTrue(public["songs"][0]["audio"]["1"]["src"].startswith("assets/"))


if __name__ == "__main__":
    unittest.main()
