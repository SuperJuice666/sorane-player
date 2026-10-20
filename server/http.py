"""Serve the built player and its audio assets."""

from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

from .config import BUILD


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BUILD), **kwargs)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def send_head(self):
        path = Path(self.translate_path(self.path)).resolve()
        if not path.is_relative_to(BUILD.resolve()):
            self.send_error(404)
            return None
        return super().send_head()

    def do_GET(self):
        if urlsplit(self.path).path == "/health":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_GET()
