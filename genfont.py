#!/usr/bin/env python3
"""Rasterise Liberation Serif into a compact bitmap-font asset (fonts.bin).

Format "MFN2" (little endian):
  0..3   magic "MFN2"
  u32    number of fonts
  per font directory entry (16 bytes):
    u16  pixel size, u8 weight (0 regular, 1 bold, 2 italic), u8 reserved,
    u16  glyph count, u32 table offset (absolute), u32 data offset (absolute)
  per glyph entry (20 bytes):
    u32  codepoint, i16 bearingX, i16 top (ink top relative to baseline, <= 0),
    u16  advance, u16 width, u16 height, u32 data offset (absolute)
  pixel data: 2-bit grey per pixel (0,1,2,3 -> 0,85,170,255), row major,
  each row padded up to a whole byte. Empty glyphs have width/height 0.

Run: python3 genfont.py  -> writes fonts.bin next to this file.
Only the sizes/weights the renderer needs are baked in.
"""
import struct
import sys
from PIL import Image, ImageDraw, ImageFont

FONT_DIR = "/usr/share/fonts/truetype/liberation/"
FILES = {
    0: "LiberationSerif-Regular.ttf",
    1: "LiberationSerif-Bold.ttf",
    2: "LiberationSerif-Italic.ttf",
}

# (pixel size, weight) pairs the renderer uses.
SPECS = [
    (11, 1), (12, 1), (13, 1), (15, 1), (24, 1), (30, 1), (54, 1),
    (11, 0), (12, 0), (13, 0), (15, 0),
    (11, 2), (13, 2), (15, 2),
]

CODEPOINTS = list(range(0x20, 0x7F)) + [
    0x2013,  # en dash
    0x2014,  # em dash
    0x2018,  # left single quote
    0x2019,  # right single quote
    0x201C,  # left double quote
    0x201D,  # right double quote
    0x00B7,  # middle dot
    0x00D7,  # multiplication sign
    0x00B0,  # degree sign
]

PAD = 4  # padding around the ink box while rendering


def render_glyph(font, ch):
    """Return (bearingX, top, advance, width, height, rows) for one glyph."""
    advance = int(round(font.getlength(ch)))
    if ch == " ":
        return (0, 0, advance, 0, 0, [])
    ascent, descent = font.getmetrics()
    cell_w = max(8, advance + 2 * PAD + 4)
    cell_h = ascent + descent + 2 * PAD
    img = Image.new("L", (cell_w, cell_h), 0)
    draw = ImageDraw.Draw(img)
    baseline = PAD + ascent
    draw.text((PAD, baseline), ch, font=font, fill=255, anchor="ls")
    bbox = img.getbbox()
    if bbox is None:
        return (0, 0, advance, 0, 0, [])
    x0, y0, x1, y1 = bbox
    width = x1 - x0
    height = y1 - y0
    rows = []
    px = img.load()
    for y in range(y0, y1):
        row = []
        for x in range(x0, x1):
            v = px[x, y]
            row.append(0 if v < 32 else 1 if v < 110 else 2 if v < 200 else 3)
        rows.append(row)
    bearing_x = x0 - PAD
    top = y0 - baseline  # <= 0 for ink above the baseline
    return (bearing_x, top, advance, width, height, rows)


def pack_rows(rows, width, height):
    """Pack 2-bit rows into bytes, each row padded to a whole byte."""
    out = bytearray()
    row_bytes = (width * 2 + 7) // 8
    for row in rows:
        buf = bytearray(row_bytes)
        for i, v in enumerate(row):
            byte_i = (i * 2) // 8
            shift = 6 - ((i * 2) % 8)
            buf[byte_i] |= (v & 3) << shift
        out.extend(buf)
    return bytes(out)


def build(out_path):
    fonts = []
    for size, weight in SPECS:
        font = ImageFont.truetype(FONT_DIR + FILES[weight], size)
        glyphs = []
        for cp in CODEPOINTS:
            ch = chr(cp)
            try:
                g = render_glyph(font, ch)
            except Exception as exc:  # missing glyph in this face
                print(f"skip U+{cp:04X} {weight}/{size}: {exc}", file=sys.stderr)
                continue
            glyphs.append((cp, g))
        fonts.append((size, weight, glyphs))

    # Lay out: header + directory + all glyph tables + all pixel data.
    n_fonts = len(fonts)
    dir_len = 8 + n_fonts * 16
    table_total = sum(20 * len(g[2]) for g in fonts)
    data_start = dir_len + table_total
    # First pass: render + pack every glyph, compute offsets.
    prepared = []
    data_off = data_start
    table_off = dir_len
    for size, weight, glyphs in fonts:
        glyph_entries = []
        pixel_blobs = []
        for cp, (bx, top, adv, w, h, rows) in glyphs:
            packed = pack_rows(rows, w, h) if w and h else b""
            glyph_entries.append((cp, bx, top, adv, w, h, data_off))
            pixel_blobs.append(packed)
            data_off += len(packed)
        prepared.append((size, weight, len(glyphs), table_off, glyph_entries, pixel_blobs))
        table_off += 20 * len(glyphs)

    buf = bytearray()
    buf += b"MFN2"
    buf += struct.pack("<I", n_fonts)
    for size, weight, count, toff, _, _ in prepared:
        buf += struct.pack("<HBBHIIxx", size, weight, 0, count, toff, data_start)
    for _, _, _, _, glyph_entries, _ in prepared:
        for cp, bx, top, adv, w, h, doff in glyph_entries:
            buf += struct.pack("<IhhHHHIxx", cp, bx, top, adv, w, h, doff)
    for *_, pixel_blobs in [(e[0], e[1], e[2], e[3], e[4], e[5]) for e in prepared]:
        for blob in pixel_blobs:
            buf += blob
    with open(out_path, "wb") as fh:
        fh.write(bytes(buf))
    total_glyphs = sum(e[2] for e in prepared)
    print(f"wrote {out_path}: {len(buf)} bytes, {n_fonts} fonts, {total_glyphs} glyphs")


if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts.bin")
    build(out)
