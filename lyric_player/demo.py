"""Generate a small, original tone fixture; no downloaded music or speech."""

import array
import math
import sys
import wave
from pathlib import Path

from .build import write_json

SR = 44100


def wav(path, samples, channels):
    samples = array.array("h", samples)
    if sys.byteorder != "little":
        samples.byteswap()
    with wave.open(str(path), "wb") as stream:
        stream.setparams((channels, 2, SR, 0, "NONE", "not compressed"))
        stream.writeframes(samples.tobytes())


def demo(destination=Path("data/songs/demo")):
    if destination.exists():
        raise ValueError(f"Destination already exists: {destination}")
    destination.mkdir(parents=True)
    phrases = [
        [("朝", "あさ", "asa"), ("の", "の", "no"), ("光", "ひかり", "hikari")],
        [("風", "かぜ", "kaze"), ("が", "が", "ga"), ("吹く", "ふく", "fuku")],
        [("空", "そら", "sora"), ("を", "を", "o"), ("見る", "みる", "miru")],
        [("今日", "きょう", "kyō"), ("も", "も", "mo"), ("歩こう", "あるこう", "arukō")],
    ]
    song = {
        "schemaVersion": 1,
        "id": "demo",
        "title": "音の練習",
        "artist": "Demo",
        "duration": 24,
        "audio": {},
        "chunks": {},
        "lines": [],
    }
    for i, phrase in enumerate(phrases):
        start = 1 + i * 6
        tokens = [
            {
                "jp": jp,
                "kana": kana,
                "romaji": roma,
                "start": start + j * 1.4,
                "end": start + j * 1.4 + 1,
            }
            for j, (jp, kana, roma) in enumerate(phrase)
        ]
        song["lines"].append(
            {
                "id": str(i + 1),
                "jp": "".join(t["jp"] for t in tokens),
                "section": "練習 " + str(i // 2 + 1),
                "start": start,
                "end": start + 3.8,
                "tokens": tokens,
            }
        )
    for rate in (1, 0.75, 0.5):
        name = f"tone-{rate}.wav"
        count = round(song["duration"] / rate * SR)
        samples = array.array("h", [0]) * (count * 4)
        for line in song["lines"]:
            for j, token in enumerate(line["tokens"]):
                a, b = round(token["start"] / rate * SR), round(token["end"] / rate * SR)
                for n in range(a, b):
                    edge = min(1, (n - a) / 300, (b - n) / 300)
                    value = int(4500 * edge * math.sin(2 * math.pi * (330 + 110 * j) * n / SR))
                    samples[n * 4 + 2] = samples[n * 4 + 3] = value
        wav(destination / name, samples, 4)
        chunks = []
        for first in range(0, count, 8 * SR):
            last = min(count, first + 8 * SR)
            chunk = f"chunk-{rate}-{first}.wav"
            wav(destination / chunk, samples[first * 4 : last * 4], 4)
            chunks.append(
                {"src": chunk, "first": first, "last": last, "decodedFrames": last - first}
            )
        song["audio"][str(rate)] = {"src": name}
        song["chunks"][name] = {"sampleRate": SR, "frames": count, "chunks": chunks}
    write_json(destination / "song.json", song)
    print(f"Created tone demo in {destination}")
