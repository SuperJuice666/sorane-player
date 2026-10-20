import http.client
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from server import http as service


class PreviewServer(unittest.TestCase):
    def test_serves_build_and_health_with_directory_access_restricted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text("<title>Sorane Player</title>", encoding="utf8")
            (root / "assets").mkdir()
            (root / "assets/audio.wav").write_bytes(b"audio fixture")
            with patch.object(service, "BUILD", root):
                server = ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    for path, status, body in [
                        ("/", 200, b"<title>Sorane Player</title>"),
                        ("/assets/audio.wav", 200, b"audio fixture"),
                        ("/health", 204, b""),
                        ("/assets/", 404, None),
                        ("/missing", 404, None),
                    ]:
                        with self.subTest(path=path):
                            connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                            connection.request("GET", path)
                            response = connection.getresponse()
                            self.assertEqual(response.status, status)
                            received = response.read()
                            if body is not None:
                                self.assertEqual(received, body)
                            connection.close()
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()
