#!/usr/bin/env python3
"""Bake Liberation Serif glyph bitmaps into fonts.json for main.ts.

Own code: uses PIL (FreeType) only to rasterise the system Liberation Serif
TTFs at the exact pixel sizes main.ts needs. No hand-drawn font anywhere.
Output is deterministic: same fonts, same sizes, same bytes.
Usage: python3 gen-fonts.py [out.json]
"""
import base64
import io
import json
import sys

from PIL import Image, ImageDraw, ImageFont

FACES = {
    "regular": "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    "bold": "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "italic": "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
}
SIZES = [7, 8, 9, 10, 12, 13, 17, 24, 44]

CHARS = "".join(chr(c) for c in range(32, 127))
CHARS += "\u2013\u2014\u2018\u2019\u201c\u201d\u00b7\u2022\u2026"
CHARS += "\u00e9\u00e8\u00ea\u00e0\u00e1\u00e2\u00e4\u00eb\u00ef\u00ee\u00f6\u00fc"
CHARS += "\u00f3\u00f2\u00fa\u00f9\u00f1\u00e7\u00df\u00ed\u00a3\u20ac\u00d7\u2264"


def bake_char(font, ch):
    """Return [advance, bearing_x, bearing_top, w, h, base64_rows] for one glyph."""
    adv = int(round(font.getlength(ch)))
    try:
        x0, y0, x1, y1 = font.getbbox(ch)
    except Exception:
        x0, y0, x1, y1 = 0, 0, 0, 0
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return [adv, 0, 0, 0, 0, ""]
    img = Image.new("L", (w + 4, h + 4), 0)
    d = ImageDraw.Draw(img)
    d.text((2 - x0, 2 - y0), ch, font=font, fill=255)
    raw = img.tobytes()
    return [adv, x0 - 2, y0 - 2, w + 4, h + 4, base64.b64encode(raw).decode("ascii")]


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "fonts.json"
    data = {"faces": {}, "sizes": SIZES}
    for face, path in FACES.items():
        data["faces"][face] = {}
        for size in SIZES:
            font = ImageFont.truetype(path, size)
            glyphs = {}
            for ch in CHARS:
                glyphs[ch] = bake_char(font, ch)
            data["faces"][face][str(size)] = glyphs
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", out_path)


if __name__ == "__main__":
    main()
