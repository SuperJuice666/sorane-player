from http.server import ThreadingHTTPServer

from . import config, http


def main():
    if not (config.BUILD / "library.json").is_file():
        raise SystemExit("Missing build/library.json. Run python -m lyric_player build.")
    print(f"Player: http://{config.HOST}:{config.PORT}", flush=True)
    try:
        ThreadingHTTPServer((config.HOST, config.PORT), http.Handler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
