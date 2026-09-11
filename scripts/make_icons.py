#!/usr/bin/env python3
"""Generate the extension's PNG icons.

The artwork is a printer tray with a sheet above it on a Google-blue rounded
square. Everything is drawn from primitives at 4x and box-filtered down, so the
edges stay smooth without pulling in an image library.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4

BLUE = (26, 115, 232, 255)
WHITE = (255, 255, 255, 255)

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"


class Canvas:
    def __init__(self, size: int) -> None:
        self.size = size
        self.pixels = bytearray(size * size * 4)

    def fill_rounded_rect(
        self,
        x0: float,
        y0: float,
        x1: float,
        y1: float,
        radius: float,
        color: tuple[int, int, int, int],
    ) -> None:
        """Fill a rounded rectangle given in normalized (0..1) coordinates."""
        s = self.size
        px0, py0, px1, py1 = x0 * s, y0 * s, x1 * s, y1 * s
        r = radius * s

        for y in range(max(0, int(py0)), min(s, int(py1) + 1)):
            cy = y + 0.5
            for x in range(max(0, int(px0)), min(s, int(px1) + 1)):
                cx = x + 0.5
                if not (px0 <= cx <= px1 and py0 <= cy <= py1):
                    continue
                if not self._inside_corner(cx, cy, px0, py0, px1, py1, r):
                    continue
                self._set(x, y, color)

    @staticmethod
    def _inside_corner(
        cx: float, cy: float, px0: float, py0: float, px1: float, py1: float, r: float
    ) -> bool:
        if r <= 0:
            return True
        # Clamp the point to the rectangle's inner box; anything further than r
        # from that box lies outside a rounded corner.
        nx = min(max(cx, px0 + r), px1 - r)
        ny = min(max(cy, py0 + r), py1 - r)
        return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r

    def _set(self, x: int, y: int, color: tuple[int, int, int, int]) -> None:
        i = (y * self.size + x) * 4
        self.pixels[i : i + 4] = bytes(color)

    def downsample(self, factor: int) -> "Canvas":
        out = Canvas(self.size // factor)
        for y in range(out.size):
            for x in range(out.size):
                totals = [0, 0, 0, 0]
                for dy in range(factor):
                    for dx in range(factor):
                        i = ((y * factor + dy) * self.size + (x * factor + dx)) * 4
                        for c in range(4):
                            totals[c] += self.pixels[i + c]
                count = factor * factor
                out._set(
                    x,
                    y,
                    (
                        totals[0] // count,
                        totals[1] // count,
                        totals[2] // count,
                        totals[3] // count,
                    ),
                )
        return out

    def to_png(self) -> bytes:
        raw = bytearray()
        stride = self.size * 4
        for y in range(self.size):
            raw.append(0)  # filter type 0 (None)
            raw.extend(self.pixels[y * stride : (y + 1) * stride])

        def chunk(tag: bytes, data: bytes) -> bytes:
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        header = struct.pack(">2I5B", self.size, self.size, 8, 6, 0, 0, 0)
        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b"")
        )


def draw_icon(size: int) -> Canvas:
    canvas = Canvas(size * SUPERSAMPLE)
    canvas.fill_rounded_rect(0, 0, 1, 1, 0.22, BLUE)

    # The sheet, drawn first so the printer body overlaps its lower edge.
    canvas.fill_rounded_rect(0.28, 0.12, 0.72, 0.70, 0.03, WHITE)

    # Text lines only survive at the larger sizes.
    if size >= 48:
        for y in (0.21, 0.30, 0.39):
            canvas.fill_rounded_rect(0.35, y, 0.65, y + 0.045, 0.02, BLUE)

    # A blue pass first leaves a gap, so the white body reads separately from
    # the white sheet instead of merging into one blob.
    canvas.fill_rounded_rect(0.145, 0.605, 0.855, 0.895, 0.07, BLUE)
    canvas.fill_rounded_rect(0.17, 0.63, 0.83, 0.87, 0.06, WHITE)
    canvas.fill_rounded_rect(0.30, 0.68, 0.70, 0.725, 0.02, BLUE)

    return canvas.downsample(SUPERSAMPLE)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icon-{size}.png"
        path.write_bytes(draw_icon(size).to_png())
        print(f"wrote {path.relative_to(OUT_DIR.parent.parent)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
