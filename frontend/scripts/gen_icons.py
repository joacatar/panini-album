#!/usr/bin/env python3
"""Genera PNG mínimos para PWA sin dependencias."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "icons"


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, size: int, rgb: tuple[int, int, int]) -> None:
    r, g, b = rgb
    row = b"\x00" + bytes((r, g, b)) * size
    raw = row * size
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        write_png(ROOT / f"icon-{size}.png", size, (0, 104, 71))
    print("Generated icons in", ROOT)


if __name__ == "__main__":
    main()
