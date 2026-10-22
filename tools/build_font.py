#!/usr/bin/env python3
"""Renders Inter (SIL OFL 1.1) glyphs into engine/src/display/font.json (8-bit alpha bitmaps).
Requires Pillow and the Inter OTFs. The generated file is committed, so users never run this."""
import base64, json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/opentype/inter'
CHARS = ''.join(chr(c) for c in range(32, 127)) + 'čćžšđČĆŽŠĐ→←↑↓…°±·•×–—▶■●▲▼◀'
SPECS = {
    'small': ('Inter-Medium.otf', 13),
    'normal': ('Inter-Medium.otf', 16),
    'bold': ('Inter-SemiBold.otf', 16),
    'big': ('Inter-SemiBold.otf', 26),
}

out = {'license': 'Glyphs rendered from Inter by Rasmus Andersson, SIL Open Font License 1.1', 'fonts': {}}
for name, (file, size) in SPECS.items():
    font = ImageFont.truetype(os.path.join(FONT_DIR, file), size)
    ascent, descent = font.getmetrics()
    def render(ch):
        bbox = font.getbbox(ch)  # relative to the drawing origin (top of ascent)
        w, h = max(0, bbox[2] - bbox[0]), max(0, bbox[3] - bbox[1])
        img = Image.new('L', (max(w, 1), max(h, 1)))
        ImageDraw.Draw(img).text((-bbox[0], -bbox[1]), ch, font=font, fill=255)
        return bbox, w, h, img.tobytes() if w and h else b''

    notdef = render('\uffff')[3]
    glyphs = {}
    for ch in CHARS:
        bbox, w, h, data = render(ch)
        if ch != ' ' and data == notdef:
            continue
        glyphs[ch] = [round(font.getlength(ch), 2), bbox[0], bbox[1], w, h, base64.b64encode(data).decode()]
    out['fonts'][name] = {'size': size, 'ascent': ascent, 'descent': descent, 'glyphs': glyphs}
    print(name, len(glyphs), 'glyphs')

with open(os.path.join(ROOT, 'engine', 'src', 'display', 'font.json'), 'w') as f:
    json.dump(out, f, separators=(',', ':'))
