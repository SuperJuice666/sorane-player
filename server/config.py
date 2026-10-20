"""Read preview settings at startup."""

import os
from pathlib import Path

BUILD = Path(os.getenv("BUILD_DIR", "build")).resolve()
HOST = os.getenv("BIND_HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8080"))
