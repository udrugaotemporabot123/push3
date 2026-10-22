'use strict';
// Stability: random configs, random MIDI from the Push and from Live, random Live API state and
// clock, with every add-on loaded. Nothing may throw, no add-on may report an error, and every
// byte sent to Live or to the Push must be valid MIDI.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../src/engine');
const { normalizeConfig, pageChannel, BUTTON_TYPES, ENCODER_MODES } = require('../src/config');
const live = require('../src/live');
const push3 = require('../src/push3');
const layout = require('../src/display/layout');
const { Canvas } = require('../src/display/canvas');
const { loadAddons } = require('../../addons');

const SYSEX = (mode) => [...push3.SYSEX_HEADER, 0x0a, mode, 0xf7];

// Small deterministic PRNG so a failure can be replayed with the same seed.
function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (arr) => arr[int(arr.length)];
  return { next, int, pick };
}

const WORDS = ['selected', '1', '2', '8', 'VIO', 'Drums', '#2', 'first', 'A', 'D', '', '0', '99', 'yes', 'no', '4', '66', 'length', 'euclid', 'chance', 'double', 'x'];

function randomParams(r, fields) {
  const p = {};
  for (const k of Object.keys(fields || {})) p[k] = r.next() < 0.7 ? r.pick(WORDS) : String(r.int(130));
  return p;
}

function randomMapping(r, ctl, addons) {
  if (ctl.kind === 'encoder') {
    const type = r.pick(['none', 'cc', 'cc', 'live']);
    return {
      type,
      number: r.int(128),
      mode: r.pick(ENCODER_MODES),
      sensitivity: r.next() * 4,
      min: r.int(128),
      max: r.int(128),
      touch: r.pick(['none', 'note']),
      stepType: r.pick(['cc', 'note']),
      upNumber: r.int(128),
      downNumber: r.int(128),
      stepSize: 1 + r.int(4),
      live: { target: r.pick(live.ENCODER_TARGETS), track: r.pick(WORDS), device: r.pick(WORDS), index: r.int(10), param: r.pick(WORDS) },
    };
  }
  if (ctl.kind === 'touchstrip') return { type: r.pick(['none', 'pitchbend', 'cc', 'live']), number: r.int(128), live: { target: r.pick(live.ENCODER_TARGETS), track: '1' } };
  const type = r.pick(BUTTON_TYPES);
  const m = {
    type,
    number: r.int(128),
    behavior: r.pick(['momentary', 'toggle', 'trigger']),
    velocity: r.pick(['dynamic', 'fixed']),
    onValue: r.int(128),
    offValue: r.int(128),
    colorOn: r.int(128),
    colorOff: r.int(128),
    anim: r.pick(['none', 'pulse', 'blink']),
    group: r.next() < 0.2 ? r.pick(['a', 'b']) : '',
    page: r.int(4),
    index: r.int(8),
    target: { track: r.pick(WORDS), rack: r.pick(WORDS) },
    pressure: r.pick(['off', 'polyAT', 'channelAT', 'cc', 'live']),
    pressureLive: { target: 'volume', track: '1' },
    extra: r.next() < 0.1 ? [{ type: 'cc', number: r.int(128), value: r.int(128) }] : [],
    live: { action: r.pick(live.BUTTON_ACTIONS), track: r.pick(WORDS), scene: r.pick(WORDS), mode: r.pick(live.PARAM_MODES), target: r.pick(live.ENCODER_TARGETS) },
  };
  if (type === 'addon') {
    const mod = r.pick(addons);
    const action = r.pick(Object.keys(mod.actions));
    m.addon = { id: mod.id, action, params: randomParams(r, mod.actions[action].fields) };
  }
  if (r.next() < 0.15) m.shift = randomMapping(r, ctl, addons);
  return m;
}

function randomConfig(r, addons) {
  const pages = [];
  const n = 1 + r.int(4);
  for (let p = 0; p < n; p++) {
    const controls = {};
    for (const ctl of push3.controls) if (r.next() < 0.6) controls[ctl.id] = randomMapping(r, ctl, addons);
    pages.push({ name: `P${p}`, channel: r.int(17), display: r.pick(['controls', 'big']), controls });
  }
  return normalizeConfig({
    settings: { baseChannel: 1 + r.int(16), shiftLayer: r.next() < 0.8, pageButtons: r.pick(['upper', 'none']), internalClock: r.next() < 0.5, addons: { looper: r.next() < 0.9 } },
    pages,
  });
}

function validMidi(bytes) {
  if (!Array.isArray(bytes) || !bytes.length) return false;
  if (bytes[0] === 0xf0) return bytes[bytes.length - 1] === 0xf7 && bytes.slice(1, -1).every((b) => Number.isInteger(b) && b >= 0 && b < 128);
  if (bytes[0] < 0x80 || bytes[0] > 0xff) return false;
  if (bytes[0] >= 0xf8) return bytes.length === 1;
  const len = (bytes[0] & 0xf0) === 0xc0 || (bytes[0] & 0xf0) === 0xd0 ? 2 : 3;
  return bytes.length === len && bytes.slice(1).every((b) => Number.isInteger(b) && b >= 0 && b < 128);
}

function run(seed, events, opts = {}) {
  const r = rng(seed);
  const mods = loadAddons(() => {});
  const errors = [];
  const bad = [];
  const count = { push: 0, host: 0 };
  const sounding = new Map(); // notes sent to Live without a note off yet -> event that sent it
  const trace = { at: '' };
  let now = 0;
  const io = {
    toPush: (b) => (count.push++, validMidi([...b]) || bad.push(['push', [...b]])),
    toHost: (b) => {
      count.host++;
      if (!validMidi([...b])) bad.push(['host', [...b]]);
      const type = b[0] & 0xf0;
      if (type === 0x90 || type === 0x80) {
        const key = `${b[0] & 15}:${b[1]}`;
        if (type === 0x90 && b[2] > 0) sounding.set(key, trace.at);
        else sounding.delete(key);
      }
    },
    toLive: () => {},
    log: (level, msg) => level === 'error' && errors.push(msg),
    now: () => now,
    setTimer: () => 0,
    clearTimer() {},
    setInterval: () => 0,
    clearInterval() {},
    loadAddonState: () => null,
    saveAddonState() {},
  };
  const e = new Engine(io, randomConfig(r, mods));
  e.setAddons(mods);
  e.setPushConnected(true);
  const canvas = new Canvas();
  const pads = push3.controls.filter((c) => c.kind === 'pad');
  const buttons = push3.controls.filter((c) => c.cc !== undefined && c.kind !== 'encoder');
  const encoders = push3.controls.filter((c) => c.kind === 'encoder');
  // Like real hands: a pad/button/touch goes down before it comes up, and never twice.
  const down = new Set();
  const toggle = (key, on, off) => {
    if (down.has(key)) {
      down.delete(key);
      e.handlePushMessage(off);
    } else {
      down.add(key);
      e.handlePushMessage(on);
    }
  };
  for (let i = 0; i < events; i++) {
    now += r.int(30);
    const k = r.next();
    trace.at = `#${i} k=${k.toFixed(3)} page=${e.page} mode=${e.mode}`;
    if (k < 0.02) e.handlePushMessage(SYSEX(r.pick([0, 1, 1, 1])));
    else if (k < 0.3) {
      const pad = r.pick(pads);
      toggle(`n${pad.note}`, [0x90, pad.note, 1 + r.int(127)], [0x80, pad.note, 0]);
    } else if (k < 0.45) {
      const cc = r.pick(buttons).cc;
      toggle(`c${cc}`, [0xb0, cc, 127], [0xb0, cc, 0]);
    }
    else if (k < 0.6) e.handlePushMessage([0xb0, r.pick(encoders).cc, r.pick([1, 2, 127, 126, 63, 65])]);
    else if (k < 0.63) e.handlePushMessage([0xe0, r.int(128), r.int(128)]);
    else if (k < 0.66) e.handlePushMessage([0xa0, r.pick(pads).note, r.int(128)]);
    else if (k < 0.7) {
      const n = r.int(14); // touch notes
      toggle(`n${n}`, [0x90, n, 127], [0x90, n, 0]);
    }
    else if (k < 0.8) e.handleHostMessage(r.pick([[0xf8], [0xf8], [0xf8], [0xfa], [0xfc], [0xfb]]));
    else if (k < 0.86) {
      if (!opts.noFeedback) e.handleHostMessage([r.pick([0x90, 0x80, 0xb0]) | r.int(16), r.int(128), r.int(128)]);
    }
    else if (k < 0.95) {
      const keys = Object.keys(e.liveTargets || {});
      const vkeys = Object.keys(e.variationTargets || {});
      if (r.next() < 0.8 && keys.length) {
        const value = r.next() < 0.3 ? Array.from({ length: r.int(9) }, () => r.int(5)) : r.next();
        e.handleLiveState({ type: 'live', key: r.pick(keys), ok: r.next() < 0.9, value, name: r.pick(WORDS), display: `${r.int(100)} dB`, track: r.pick(WORDS), color: [r.int(256), r.int(256), r.int(256)] });
      } else if (vkeys.length) e.handleLiveState({ type: 'variations', key: r.pick(vkeys), ok: true, count: r.int(9), selected: r.int(9) - 1, name: 'Rack' });
      else e.handleLiveState({ type: 'notice', text: 'x' });
    } else if (k < 0.97) e.setPage(r.int(5));
    else if (k < 0.975) {
      if (!opts.fixedConfig) e.setConfig(randomConfig(r, mods));
    }
    else if (k < 0.99) {
      const model = layout.buildModel(e, e.palette || [], r.next() < 0.5 ? { title: 'T', detail: 'D', at: now } : null, now);
      layout.draw(canvas, model);
    }
  }
  // Leaving: hands off, Live stops, then the user leaves User Mode.
  if (opts.liftHands) for (const key of down) e.handlePushMessage(key[0] === 'n' ? [0x80, Number(key.slice(1)), 0] : [0xb0, Number(key.slice(1)), 0]);
  e.handleHostMessage([0xfc]);
  e.handlePushMessage(SYSEX(0));
  return { errors, bad, count, sounding, engine: e };
}

// Notes a toggle may legitimately leave on (its state is "on").
function toggleNotes(cfg) {
  const out = new Set();
  cfg.pages.forEach((page, pi) => {
    const pch = pageChannel(cfg, pi);
    for (const m0 of Object.values(page.controls)) {
      for (const m of [m0, m0.shift]) {
        if (!m || m.behavior !== 'toggle') continue;
        const ch = m.channel ? m.channel - 1 : pch;
        if (m.type === 'note') out.add(`${ch}:${m.number}`);
        for (const x of m.extra || []) if (x.type === 'note') out.add(`${x.channel ? x.channel - 1 : ch}:${x.number}`);
      }
    }
  });
  return out;
}

for (const [seed, liftHands] of [[7, false], [8, true], [9, false]]) {
  test(`fuzz: no stuck notes in Live after leaving User Mode (seed ${seed}${liftHands ? ', hands lifted' : ''})`, () => {
    const { sounding, engine } = run(seed, 8000, { fixedConfig: seed !== 9, liftHands, noFeedback: true });
    const allowed = toggleNotes(engine.config);
    const stuck = [...sounding.keys()].filter((k) => !allowed.has(k));
    assert.deepEqual(stuck, []);
  });
}

for (const seed of [1, 2, 3, 42, 2026]) {
  test(`fuzz: random configs and MIDI never crash or send invalid MIDI (seed ${seed})`, () => {
    const { errors, bad, count } = run(seed, 6000);
    assert.deepEqual(errors, []);
    assert.deepEqual(bad.slice(0, 5), []);
    assert.ok(count.push > 500 && count.host > 500, JSON.stringify(count)); // the run really exercised the engine
  });
}

module.exports = { run };
