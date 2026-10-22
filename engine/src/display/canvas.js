'use strict';
// Minimal raster canvas for the Push 3 display (960x160): rects, anti-aliased text from a
// pre-rendered glyph atlas, Push frame encoding (BGR565 + signal shaping) and PNG export.

const zlib = require('zlib');
const fontData = require('./font.json');

const WIDTH = 960;
const HEIGHT = 160;
const LINE_BYTES = 2048; // 960 * 2 pixel bytes + 128 filler bytes per line
const FRAME_BYTES = LINE_BYTES * HEIGHT;
const FRAME_HEADER = Buffer.from([0xff, 0xcc, 0xaa, 0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const XOR = [0xe7, 0xf3, 0xe7, 0xff];

// Decode glyph bitmaps once.
const FONTS = {};
for (const [name, f] of Object.entries(fontData.fonts)) {
  const glyphs = new Map();
  for (const [ch, [adv, x0, y0, w, h, b64]] of Object.entries(f.glyphs)) glyphs.set(ch, { adv, x0, y0, w, h, alpha: Buffer.from(b64, 'base64') });
  FONTS[name] = { size: f.size, ascent: f.ascent, descent: f.descent, glyphs };
}

function parseColor(c) {
  if (Array.isArray(c)) return c;
  const s = String(c).replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

class Canvas {
  constructor(width = WIDTH, height = HEIGHT) {
    this.width = width;
    this.height = height;
    this.rgb = new Uint8Array(width * height * 3);
  }

  clear(color = [0, 0, 0]) {
    const [r, g, b] = parseColor(color);
    for (let i = 0; i < this.rgb.length; i += 3) {
      this.rgb[i] = r;
      this.rgb[i + 1] = g;
      this.rgb[i + 2] = b;
    }
  }

  fillRect(x, y, w, h, color) {
    const [r, g, b] = parseColor(color);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * this.width + x0) * 3;
      for (let xx = x0; xx < x1; xx++, i += 3) {
        this.rgb[i] = r;
        this.rgb[i + 1] = g;
        this.rgb[i + 2] = b;
      }
    }
  }

  strokeRect(x, y, w, h, color) {
    this.fillRect(x, y, w, 1, color);
    this.fillRect(x, y + h - 1, w, 1, color);
    this.fillRect(x, y, 1, h, color);
    this.fillRect(x + w - 1, y, 1, h, color);
  }

  measure(text, font = 'normal') {
    const f = FONTS[font];
    let w = 0;
    for (const ch of String(text)) {
      const g = f.glyphs.get(ch) || f.glyphs.get('?');
      w += g.adv;
    }
    return w;
  }

  // Shorten with an ellipsis so the text fits maxWidth.
  fit(text, maxWidth, font = 'normal') {
    let s = String(text);
    if (this.measure(s, font) <= maxWidth) return s;
    while (s.length > 1 && this.measure(`${s}…`, font) > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  }

  // y is the top of the line box. align: 'left' | 'center' | 'right' (relative to x).
  text(x, y, text, { font = 'normal', color = [255, 255, 255], align = 'left', maxWidth } = {}) {
    const f = FONTS[font];
    let s = String(text);
    if (maxWidth) s = this.fit(s, maxWidth, font);
    const w = this.measure(s, font);
    let pen = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const [r, g, b] = parseColor(color);
    for (const ch of s) {
      const gl = f.glyphs.get(ch) || f.glyphs.get('?');
      const gx = Math.round(pen + gl.x0);
      const gy = Math.round(y + gl.y0);
      for (let row = 0; row < gl.h; row++) {
        const py = gy + row;
        if (py < 0 || py >= this.height) continue;
        for (let col = 0; col < gl.w; col++) {
          const a = gl.alpha[row * gl.w + col];
          if (!a) continue;
          const px = gx + col;
          if (px < 0 || px >= this.width) continue;
          const i = (py * this.width + px) * 3;
          const k = a / 255;
          this.rgb[i] += (r - this.rgb[i]) * k;
          this.rgb[i + 1] += (g - this.rgb[i + 1]) * k;
          this.rgb[i + 2] += (b - this.rgb[i + 2]) * k;
        }
      }
      pen += gl.adv;
    }
    return w;
  }

  // Push 2/3 display frame: BGR565 little endian, 128 filler bytes per line, XOR shaped.
  toPushFrame(out = Buffer.alloc(FRAME_BYTES)) {
    let o = 0;
    for (let y = 0; y < HEIGHT; y++) {
      let i = y * this.width * 3;
      for (let x = 0; x < WIDTH; x++, i += 3) {
        const px = ((this.rgb[i + 2] >> 3) << 11) | ((this.rgb[i + 1] >> 2) << 5) | (this.rgb[i] >> 3);
        out[o++] = px & 0xff;
        out[o++] = px >> 8;
      }
      out.fill(0, o, o + 128);
      o += 128;
    }
    for (let p = 0; p < FRAME_BYTES; p++) out[p] ^= XOR[p & 3];
    return out;
  }

  toPNG() {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 3 + 1)] = 0;
      Buffer.from(this.rgb.buffer, y * this.width * 3, this.width * 3).copy(raw, y * (this.width * 3 + 1) + 1);
    }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  }
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

module.exports = { Canvas, WIDTH, HEIGHT, FRAME_BYTES, FRAME_HEADER, parseColor };
