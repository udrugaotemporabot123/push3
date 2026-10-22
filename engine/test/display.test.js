'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Canvas, FRAME_BYTES } = require('../src/display/canvas');
const { buildModel, draw } = require('../src/display/layout');
const { DisplayManager } = require('../src/display/manager');
const { Engine } = require('../src/engine');
const { defaultConfig } = require('../src/config');
const { DEFAULT_PALETTE } = require('../src/palette');
const push3 = require('../src/push3');

const io = { toPush() {}, toHost() {}, toLive() {}, log() {}, now: () => 0, setTimer: () => 0, clearTimer() {}, setInterval: () => 0, clearInterval() {} };
const SYSEX_USER = [...push3.SYSEX_HEADER, 0x0a, 0x01, 0xf7];
const SYSEX_LIVE = [...push3.SYSEX_HEADER, 0x0a, 0x00, 0xf7];

test('black frame is exactly the signal-shaping pattern', () => {
  const c = new Canvas();
  c.clear([0, 0, 0]);
  const f = c.toPushFrame();
  assert.equal(f.length, FRAME_BYTES);
  assert.deepEqual([...f.subarray(0, 8)], [0xe7, 0xf3, 0xe7, 0xff, 0xe7, 0xf3, 0xe7, 0xff]);
});

test('white pixel encodes as BGR565 0xFFFF before shaping', () => {
  const c = new Canvas();
  c.clear([0, 0, 0]);
  c.fillRect(0, 0, 1, 1, [255, 255, 255]);
  const f = c.toPushFrame();
  assert.equal(f[0] ^ 0xe7, 0xff);
  assert.equal(f[1] ^ 0xf3, 0xff);
});

test('pure red lands in the low 5 bits (BGR565)', () => {
  const c = new Canvas();
  c.clear([255, 0, 0]);
  const f = c.toPushFrame();
  const px = (f[0] ^ 0xe7) | ((f[1] ^ 0xf3) << 8);
  assert.equal(px, 0x001f);
});

test('text renders and is clipped safely at the edges', () => {
  const c = new Canvas();
  c.clear();
  c.text(-20, -5, 'Čćžšđ → test', { font: 'big' });
  c.text(950, 150, 'overflow', { font: 'normal' });
  assert.ok(c.rgb.some((v) => v > 0));
  assert.ok(c.fit('a very long label indeed', 60, 'small').endsWith('…'));
});

test('layout draws every page without throwing', () => {
  const cfg = defaultConfig(6);
  cfg.settings.pageButtons = 'none';
  const e = new Engine(io, cfg);
  e.handlePushMessage(SYSEX_USER);
  const c = new Canvas();
  for (let p = 0; p < 6; p++) {
    e.setPage(p);
    draw(c, buildModel(e, DEFAULT_PALETTE, { title: 'x', detail: 'y', at: 0 }, 100));
  }
  assert.ok(c.toPNG().length > 100);
});

function fakeTransport() {
  return {
    state: 'closed',
    detail: '',
    opens: 0,
    closes: 0,
    sent: 0,
    async open() {
      this.opens++;
      this.state = 'active';
      return this.state;
    },
    async close() {
      this.closes++;
      this.state = 'closed';
    },
    async send() {
      this.sent++;
      return true;
    },
  };
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

test('takeover: display is claimed in User Mode and handed back on exit', async () => {
  const cfg = defaultConfig();
  cfg.settings.display = 'takeover';
  const realIo = { ...io, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (t) => clearTimeout(t), setInterval: () => 0 };
  const e = new Engine(realIo, cfg);
  e.setPushConnected(true);
  const t = fakeTransport();
  const m = new DisplayManager({ engine: e, palette: DEFAULT_PALETTE, log() {}, onPreview() {}, transport: t });
  e.handlePushMessage(SYSEX_USER);
  await tick();
  assert.equal(t.opens, 1);
  assert.ok(t.sent >= 1);
  e.handlePushMessage(SYSEX_LIVE);
  await tick();
  assert.equal(t.closes, 1);
  await m.shutdown();
});

test('display setting "editor" never touches the hardware', async () => {
  const e = new Engine(io, defaultConfig());
  const t = fakeTransport();
  const m = new DisplayManager({ engine: e, palette: DEFAULT_PALETTE, log() {}, onPreview() {}, transport: t });
  e.handlePushMessage(SYSEX_USER);
  await tick();
  assert.equal(t.opens, 0);
  await m.shutdown();
});

test('USB display: a frame that hangs hands the display back and stops further tries (safety)', async () => {
  const { UsbTransport } = require('../src/display/usb-transport');
  const logs = [];
  const t = new UsbTransport((l, m) => logs.push(m));
  let released = false;
  t.device = {
    transferOut: () => new Promise(() => {}), // never completes: Live is fighting for the link
    releaseInterface: async () => (released = true),
    close: async () => {},
    opened: true,
  };
  t.state = 'active';
  const ok = await t.send(Buffer.alloc(16));
  assert.equal(ok, false);
  assert.equal(released, true);
  assert.equal(t.disabled, true);
  assert.equal(await t.open(), 'busy'); // no new attempt in this session
});
