import copy
import tempfile
import unittest
from pathlib import Path

from lyric_player.schema import asset, validate


def song():
    return {
        "schemaVersion": 1,
        "id": "example",
        "title": "Example",
        "artist": "Demo",
        "duration": 2,
        "audio": {rate: {"src": "tone.wav"} for rate in ("1", "0.75", "0.5")},
        "lines": [
            {
                "jp": "朝",
                "section": "Verse",
                "start": 0.2,
                "end": 1.5,
                "tokens": [{"jp": "朝", "kana": "あさ", "romaji": "asa", "start": 0.2, "end": 1.5}],
            }
        ],
    }


class Schema(unittest.TestCase):
    def test_single_timeline(self):
        validate(song())
        for value in (float("nan"), float("inf"), -1, 3):
            data = song()
            data["lines"][0]["tokens"][0]["start"] = value
            with self.assertRaises(ValueError):
                validate(data)

    def test_overlap_is_an_error_not_silently_clipped(self):
        data = song()
        data["lines"].append(copy.deepcopy(data["lines"][0]))
        with self.assertRaisesRegex(ValueError, "overlapping"):
            validate(data)

    def test_assets_cannot_escape_song_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "song"
            root.mkdir()
            (Path(folder) / "private.txt").write_text("secret")
            for name in (
                "../private.txt",
                "C:/private.txt",
                "https://example.com/a",
                "..\\private.txt",
            ):
                with self.assertRaises(ValueError):
                    asset(root, name)

    def test_missing_narration_marks_rejected(self):
        data = song()
        data["lines"][0]["narration"] = {
            speed: {"src": "a.wav", "duration": 2, "tokens": []}
            for speed in ("normal", "slow", "verySlow")
        }
        with self.assertRaisesRegex(ValueError, "token count"):
            validate(data)
