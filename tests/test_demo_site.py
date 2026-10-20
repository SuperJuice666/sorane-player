import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from lyric_player.demo_site import unpack


class DemoPackage(unittest.TestCase):
    def test_rejects_changed_package_and_paths_outside_song_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "package.zip"
            with zipfile.ZipFile(archive, "w") as stream:
                stream.writestr("songs/../../outside.txt", "test")
            with self.assertRaisesRegex(ValueError, "checksum"):
                unpack(archive, root / "out", "0" * 64)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, "path"):
                unpack(archive, root / "out", digest)
            self.assertFalse((root / "outside.txt").exists())
