'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../src/engine');
const { defaultConfig } = require('../src/config');
const live = require('../src/live');
const push3 = require('../src/push3');
const looper = require('../../addons/looper');

const SYSEX_USER = [...push3.SYSEX_HEADER, 0x0a, 0x01, 0xf7];

function setup(mutate, mods = [looper]) {
  const out = { push: [], host: [], live: [], logs: [] };
  const io = {
    toPush: (b) => out.push.push([...b]),
    toHost: (b) => out.host.push([...b]),
    toLive: (o) => out.live.push(o),
    log: (l, m) => out.logs.push(`${l}: ${m}`),
    now: () => 0,
    setTimer: () => 0,
    clearTimer() {},
    setInterval: () => 0,
    clearInterval() {},
  };
  const cfg = defaultConfig();
  if (mutate) mutate(cfg);
  const e = new Engine(io, cfg);
  e.setAddons(mods);
  e.setPushConnected(true);
  e.handlePushMessage(SYSEX_USER);
  return { e, out, clear: () => Object.keys(out).forEach((k) => (out[k].length = 0)) };
}

const slotsKey = (track) => live.liveKey({ t: 'trackSlots', track });
const armKey = (track) => live.liveKey({ t: 'trackProp', track, prop: 'arm' });

test('looper: watches the track and records into the next empty slot, then closes the loop', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.record, { type: 'addon', addon: { id: 'looper', action: 'recNext', params: { track: 'VIO' } } });
  });
  const watched = Object.keys(out.live.filter((x) => x.cmd === 'watchLive').at(-1).targets);
  assert.ok(watched.includes(slotsKey('VIO')));
  e.handleLiveState({ type: 'live', key: armKey('VIO'), ok: true, value: 0 });
  e.handleLiveState({ type: 'live', key: slotsKey('VIO'), ok: true, value: [2, 1, 0, 0] });
  clear();
  e.handlePushMessage([0xb0, 86, 127]);
  assert.deepEqual(out.live, [
    { cmd: 'liveSet', key: armKey('VIO'), spec: { t: 'trackProp', track: 'VIO', prop: 'arm' }, value: 1 },
    { cmd: 'liveCall', spec: { t: 'slot', track: 'VIO', scene: 3 }, fn: 'fireSlot' },
  ]);
  // Now recording in slot 3: LED blinks red, next press closes the loop on the same slot.
  e.handleLiveState({ type: 'live', key: slotsKey('VIO'), ok: true, value: [2, 1, 3, 0] });
  e.handlePushMessage([0xb0, 86, 0]);
  assert.deepEqual(out.push.filter((m) => (m[0] & 0xf0) === 0xb0 && m[1] === 86).at(-1), [0xb0 | push3.ANIMATIONS.blink, 86, 5]);
  clear();
  e.handlePushMessage([0xb0, 86, 127]);
  assert.deepEqual(out.live, [{ cmd: 'liveCall', spec: { t: 'slot', track: 'VIO', scene: 3 }, fn: 'fireSlot' }]);
});

test('looper: undo deletes the last clip, play/stop toggles the track', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.undo, { type: 'addon', addon: { id: 'looper', action: 'undoLast', params: { track: '2' } } });
    Object.assign(c.pages[0].controls.play, { type: 'addon', addon: { id: 'looper', action: 'playStop', params: { track: '2' } } });
  });
  e.handleLiveState({ type: 'live', key: slotsKey('2'), ok: true, value: [1, 2, 0] });
  clear();
  e.handlePushMessage([0xb0, 119, 127]);
  e.handlePushMessage([0xb0, 85, 127]);
  assert.deepEqual(out.live, [
    { cmd: 'liveCall', spec: { t: 'slot', track: '2', scene: 2 }, fn: 'deleteSlot' },
    { cmd: 'liveCall', spec: { t: 'trackSelect', track: '2' }, fn: 'stopTrack' },
  ]);
});

test('a broken add-on never breaks the core', () => {
  const broken = {
    id: 'broken',
    create: () => ({
      watch() {
        throw new Error('boom');
      },
      press() {
        throw new Error('boom');
      },
      led() {
        throw new Error('boom');
      },
    }),
  };
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.mute, { type: 'addon', addon: { id: 'broken', action: 'x', params: {} } });
  }, [broken]);
  clear();
  e.handlePushMessage([0xb0, 60, 127]);
  e.handlePushMessage([0x90, 36, 100]); // the rest keeps working
  assert.deepEqual(out.host, [[0x94, 36, 100]]);
  assert.ok(out.logs.some((l) => l.includes('broken.press failed')));
});

test('disabled add-on leaves its controls inert', () => {
  const { e, out, clear } = setup((c) => {
    c.settings.addons = { looper: false };
    Object.assign(c.pages[0].controls.record, { type: 'addon', addon: { id: 'looper', action: 'recNext', params: { track: 'VIO' } } });
  });
  e.handleLiveState({ type: 'live', key: slotsKey('VIO'), ok: true, value: [0] });
  clear();
  e.handlePushMessage([0xb0, 86, 127]);
  assert.equal(out.live.length, 0);
});

test('sampler: first press records on the source, second stops and loads it into the next pad', () => {
  const sampler = require('../../addons/sampler');
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.capture, { type: 'addon', addon: { id: 'sampler', action: 'sampleToPad', params: { source: 'MIC', target: 'DRUMS', rack: 'first', autoArm: 'yes' } } });
  }, [sampler]);
  e.handleLiveState({ type: 'live', key: slotsKey('MIC'), ok: true, value: [1, 0, 0] });
  e.handleLiveState({ type: 'live', key: armKey('MIC'), ok: true, value: 1 });
  clear();
  e.handlePushMessage([0xb0, 65, 127]);
  assert.deepEqual(out.live, [{ cmd: 'liveCall', spec: { t: 'slot', track: 'MIC', scene: 2 }, fn: 'fireSlot' }]);
  e.handleLiveState({ type: 'live', key: slotsKey('MIC'), ok: true, value: [1, 3, 0] });
  e.handlePushMessage([0xb0, 65, 0]);
  clear();
  e.handlePushMessage([0xb0, 65, 127]);
  assert.deepEqual(out.live, [
    { cmd: 'liveCall', spec: { t: 'slot', track: 'MIC', scene: 2 }, fn: 'fireSlot' },
    { cmd: 'liveCall', spec: { t: 'clipToPad', source: 'MIC', scene: 2, target: 'DRUMS', rack: 'first', pad: 'next', mode: 'oneshot' }, fn: 'clipToPad' },
  ]);
  // Bridge notices show up as log lines (and on the display).
  e.handleLiveState({ type: 'notice', text: 'Uzorak → D1' });
  assert.ok(out.logs.includes('info: Uzorak → D1'));
});

test('step sequencer: steps toggle with velocity and play on Live clock', () => {
  const stepseq = require('../../addons/stepseq');
  const { e, out, clear } = setup((c) => {
    for (let lane = 1; lane <= 2; lane++) {
      for (let step = 1; step <= 4; step++) {
        Object.assign(c.pages[0].controls[`pad.${lane - 1}.${step - 1}`], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'A', lane: String(lane), step: String(step), note: String(35 + lane) } } });
      }
    }
  }, [stepseq]);
  // Lane 1: steps 1 and 3; lane 2: step 2 (velocity from the hit).
  e.handlePushMessage([0x90, 36, 90]);
  e.handlePushMessage([0x80, 36, 0]);
  e.handlePushMessage([0x90, 38, 70]);
  e.handlePushMessage([0x80, 38, 0]);
  e.handlePushMessage([0x90, 45, 110]);
  e.handlePushMessage([0x80, 45, 0]);
  assert.equal(out.host.length, 0); // step pads do not send MIDI themselves
  clear();
  e.handleHostMessage([0xfa]);
  for (let i = 0; i < 24; i++) e.handleHostMessage([0xf8]);
  const notes = out.host.filter((m) => m[2] > 0);
  // Page channel 5 (0x94): step 1 -> 36@90, step 2 -> 37@110, step 3 -> 36@70, step 4 -> nothing.
  assert.deepEqual(notes, [
    [0x94, 36, 90],
    [0x94, 37, 110],
    [0x94, 36, 70],
  ]);
  // Every note gets its note off; stop flushes anything still sounding.
  e.handleHostMessage([0xfc]);
  const offs = out.host.filter((m) => m[2] === 0);
  assert.equal(offs.length, 3);
});

test('looper: fixed-length recording passes the bar count to the bridge', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.record, { type: 'addon', addon: { id: 'looper', action: 'recNext', params: { track: 'VIO', bars: '4', autoArm: 'no' } } });
  });
  e.handleLiveState({ type: 'live', key: slotsKey('VIO'), ok: true, value: [0, 0] });
  clear();
  e.handlePushMessage([0xb0, 86, 127]);
  assert.deepEqual(out.live, [{ cmd: 'liveCall', spec: { t: 'slot', track: 'VIO', scene: 1 }, fn: 'fireSlot', recordBars: 4 }]);
});

test('step sequencer: drum pads play, select the lane and record hits into the nearest step', () => {
  const stepseq = require('../../addons/stepseq');
  const { e, out, clear } = setup((c) => {
    const ctl = c.pages[0].controls;
    Object.assign(ctl['pad.0.0'], { type: 'addon', addon: { id: 'stepseq', action: 'hit', params: { seq: 'D', lane: '1', note: '36' } } });
    Object.assign(ctl['pad.0.1'], { type: 'addon', addon: { id: 'stepseq', action: 'hit', params: { seq: 'D', lane: '2', note: '37' } } });
    for (let step = 1; step <= 4; step++) Object.assign(ctl[`pad.7.${step - 1}`], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'D', lane: 'selected', step: String(step) } } });
    Object.assign(ctl['scene.2'], { type: 'addon', addon: { id: 'stepseq', action: 'rec', params: { seq: 'D' } } });
  }, [stepseq]);
  // A hit plays immediately (page channel 5) and its release sends the note off.
  e.handlePushMessage([0x90, 37, 80]);
  e.handlePushMessage([0x80, 37, 0]);
  assert.deepEqual(out.host, [[0x94, 37, 80], [0x94, 37, 0]]);
  // Lane 2 is now selected: the step pads edit lane 2.
  e.handlePushMessage([0x90, 92, 100]); // pad.7.0 = step 1
  e.handlePushMessage([0x80, 92, 0]);
  // Record lane 1 live: one hit just after step 2 starts, one late in step 3 (goes to step 4).
  e.handlePushMessage([0xb0, 37, 127]); // scene.2 = rec
  e.handlePushMessage([0xb0, 37, 0]);
  clear();
  e.handleHostMessage([0xfa]);
  for (let i = 0; i < 7; i++) e.handleHostMessage([0xf8]); // ticks 0..6: steps 1, 2
  e.handlePushMessage([0x90, 36, 90]);
  e.handlePushMessage([0x80, 36, 0]);
  for (let i = 0; i < 4; i++) e.handleHostMessage([0xf8]); // ticks 7..10 (tick 9 not a step)
  for (let i = 0; i < 5; i++) e.handleHostMessage([0xf8]); // ticks 11..15: step 3 at 12
  e.handlePushMessage([0x90, 36, 70]); // tick 16: late in step 3 -> step 4
  e.handlePushMessage([0x80, 36, 0]);
  for (let i = 0; i < 8; i++) e.handleHostMessage([0xf8]); // ticks 16..23: step 4 at 18 is skipped once
  e.handleHostMessage([0xfc]);
  clear();
  // Second pass: step 1 lane 2 (37), step 2 lane 1 (36@90), step 4 lane 1 (36@70).
  e.handleHostMessage([0xfa]);
  for (let i = 0; i < 24; i++) e.handleHostMessage([0xf8]);
  assert.deepEqual(out.host.filter((m) => m[2] > 0), [[0x94, 37, 100], [0x94, 36, 90], [0x94, 36, 70]]);
});

test('step sequencer: swing delays every second 16th', () => {
  const stepseq = require('../../addons/stepseq');
  const { e, out, clear } = setup((c) => {
    const ctl = c.pages[0].controls;
    for (let step = 1; step <= 2; step++) Object.assign(ctl[`pad.0.${step - 1}`], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'S', lane: '1', step: String(step), note: '36' } } });
    Object.assign(ctl['scene.1'], { type: 'addon', addon: { id: 'stepseq', action: 'play', params: { seq: 'S', swing: '66' } } });
  }, [stepseq]);
  e.handlePushMessage([0x90, 36, 100]);
  e.handlePushMessage([0x90, 37, 100]);
  clear();
  e.handleHostMessage([0xfa]);
  const at = [];
  for (let i = 0; i < 12; i++) {
    const n = out.host.length;
    e.handleHostMessage([0xf8]);
    if (out.host.slice(n).some((m) => m[2] > 0)) at.push(i);
  }
  assert.deepEqual(at, [0, 8]); // step 2 at tick 6 + 2 swing ticks
});

test('looper: clear all needs Shift and deletes every clip of the track', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.0.0'], { type: 'addon', addon: { id: 'looper', action: 'clearAll', params: { track: 'VIO' } } });
  });
  e.handleLiveState({ type: 'live', key: slotsKey('VIO'), ok: true, value: [2, 1, 0, 1] });
  assert.equal(e.addonStatus()[0], 'Looper VIO 3 loopa');
  clear();
  e.handlePushMessage([0x90, 36, 100]);
  e.handlePushMessage([0x80, 36, 0]);
  assert.deepEqual(out.live, []);
  e.handlePushMessage([0xb0, 49, 127]); // shift
  e.handlePushMessage([0x90, 36, 100]);
  assert.deepEqual(out.live.map((c) => c.spec.scene), [1, 2, 4]);
  assert.ok(out.live.every((c) => c.fn === 'deleteSlot'));
});

test('add-ons: status line and action labels reach the display model', () => {
  const stepseq = require('../../addons/stepseq');
  const sampler = require('../../addons/sampler');
  const layout = require('../src/display/layout');
  const { e } = setup((c) => {
    const ctl = c.pages[0].controls;
    Object.assign(ctl['pad.0.0'], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'A', lane: '1', step: '1', note: '36' } } });
    Object.assign(ctl['pad.0.1'], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'A', lane: '1', step: '2', note: '36' } } });
    Object.assign(ctl['scene.2'], { type: 'addon', addon: { id: 'stepseq', action: 'rec', params: { seq: 'A' } } });
    Object.assign(ctl['lower.1'], { type: 'addon', addon: { id: 'sampler', action: 'targetPad', params: { note: '38' } } });
  }, [stepseq, sampler]);
  e.handlePushMessage([0xb0, 37, 127]); // rec on
  e.handlePushMessage([0xb0, 20, 127]); // lower.1: target D1
  const model = layout.buildModel(e, e.palette || [], null, 0);
  assert.match(model.status, /Seq A ■ –\/2 ● REC/);
  assert.match(model.status, /Sampler cilj D1/);
  assert.equal(model.lower[0].label, 'Odaberi ciljni pad');
});

test('step sequencer: loop length, euclid fill, chance and double', () => {
  const stepseq = require('../../addons/stepseq');
  const { e, out, clear } = setup((c) => {
    const ctl = c.pages[0].controls;
    for (let step = 1; step <= 16; step++) {
      const row = 7 - Math.floor((step - 1) / 8);
      Object.assign(ctl[`pad.${row}.${(step - 1) % 8}`], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'E', lane: '1', step: String(step), note: '36' } } });
    }
    ['length', 'euclid', 'chance', 'double'].forEach((mode, i) => Object.assign(ctl[`pad.0.${i}`], { type: 'addon', addon: { id: 'stepseq', action: 'mod', params: { seq: 'E', mode } } }));
  }, [stepseq]);
  const stepNote = (step) => (step <= 8 ? 92 + step - 1 : 84 + step - 9);
  const tap = (note) => (e.handlePushMessage([0x90, note, 100]), e.handlePushMessage([0x80, note, 0]));
  // Hold Length + step 4: loop = 4 steps.
  e.handlePushMessage([0x90, 36, 100]);
  tap(stepNote(4));
  e.handlePushMessage([0x80, 36, 0]);
  assert.match(e.addonStatus()[0], /\/4$/);
  // Hold Euclid + step 3: 3 hits over 4 steps -> x . x x (Bjorklund E(3,4)).
  e.handlePushMessage([0x90, 37, 100]);
  tap(stepNote(3));
  e.handlePushMessage([0x80, 37, 0]);
  // Double: loop 8, steps copied.
  tap(39);
  assert.match(e.addonStatus()[0], /\/8$/);
  clear();
  e.handleHostMessage([0xfa]);
  const played = [];
  for (let i = 0; i < 48; i++) {
    const n = out.host.length;
    e.handleHostMessage([0xf8]);
    if (out.host.slice(n).some((m) => m[2] > 0)) played.push(i / 6 + 1);
  }
  assert.deepEqual(played, [1, 3, 4, 5, 7, 8]);
  // Chance: a step at 25 % plays sometimes, never always.
  e.handleHostMessage([0xfc]);
  e.handlePushMessage([0x90, 38, 100]);
  for (let k = 0; k < 3; k++) tap(stepNote(1)); // 100 -> 75 -> 50 -> 25
  e.handlePushMessage([0x80, 38, 0]);
  const rnd = Math.random;
  try {
    Math.random = () => 0.5; // 50 >= 25: skipped
    clear();
    e.handleHostMessage([0xfa]);
    e.handleHostMessage([0xf8]);
    assert.equal(out.host.filter((m) => m[2] > 0).length, 0);
    Math.random = () => 0.1;
    e.handleHostMessage([0xfa]);
    e.handleHostMessage([0xf8]);
    assert.equal(out.host.filter((m) => m[2] > 0).length, 1);
  } finally {
    Math.random = rnd;
  }
});

test('step sequencer: hold a step + encoders edit velocity, chance and gate; release removes only untouched steps', () => {
  const stepseq = require('../../addons/stepseq');
  const { e, out, clear } = setup((c) => {
    for (let step = 1; step <= 2; step++) Object.assign(c.pages[0].controls[`pad.0.${step - 1}`], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'G', lane: '1', step: String(step), note: '36' } } });
  }, [stepseq]);
  e.handlePushMessage([0x90, 36, 100]); // step 1 on (vel 100)
  e.handlePushMessage([0xb0, 71, 10]); // enc 1: +10 velocity
  e.handlePushMessage([0xb0, 73, 6]); // enc 3: gate 3 + 6 = 9 ticks
  clear();
  e.handlePushMessage([0xb0, 72, 127]); // enc 2: -5 % chance; consumed by the step, nothing goes to Live
  assert.deepEqual(out.host, []);
  assert.match(e.addonStatus()[0], /Korak 1: vel 110 · 95%/);
  e.handlePushMessage([0x80, 36, 0]);
  // Press again and release without turning: the step goes away; press + turn keeps it.
  e.handlePushMessage([0x90, 37, 90]);
  e.handlePushMessage([0x80, 37, 0]); // step 2 on
  e.handlePushMessage([0x90, 37, 90]);
  e.handlePushMessage([0x80, 37, 0]); // step 2 off
  e.handlePushMessage([0xb0, 72, 1]); // not held: encoder behaves normally again
  assert.equal(out.host.length, 1);
  clear();
  e.handleHostMessage([0xfa]);
  const rnd = Math.random;
  Math.random = () => 0; // chance 95 %: plays
  try {
    for (let i = 0; i < 12; i++) e.handleHostMessage([0xf8]);
  } finally {
    Math.random = rnd;
  }
  // Step 1 at 110, its note off 9 ticks later; step 2 silent.
  assert.deepEqual(out.host, [[0x94, 36, 110], [0x94, 36, 0]]);
});

test('step sequencer: pattern slots switch at the loop end, Shift copies', () => {
  const stepseq = require('../../addons/stepseq');
  const { e, out, clear } = setup((c) => {
    const ctl = c.pages[0].controls;
    for (let step = 1; step <= 2; step++) Object.assign(ctl[`pad.0.${step - 1}`], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'P', lane: '1', step: String(step), note: '36' } } });
    ['A', 'B'].forEach((slot, i) => Object.assign(ctl[`pad.1.${i}`], { type: 'addon', addon: { id: 'stepseq', action: 'pattern', params: { seq: 'P', slot } } }));
  }, [stepseq]);
  const tap = (note) => (e.handlePushMessage([0x90, note, 100]), e.handlePushMessage([0x80, note, 0]));
  tap(36); // A: step 1
  e.handlePushMessage([0xb0, 49, 127]);
  tap(45); // Shift + B: copy A into B
  e.handlePushMessage([0xb0, 49, 0]);
  tap(45); // stopped: switch to B at once
  tap(37); // B: add step 2
  tap(44); // back to A (step 1 only)
  assert.match(e.addonStatus()[0], /pat A/);
  clear();
  e.handleHostMessage([0xfa]);
  const hits = [];
  const tick = () => {
    const n = out.host.length;
    e.handleHostMessage([0xf8]);
    return out.host.slice(n).filter((m) => m[2] > 0).length;
  };
  hits.push(tick()); // step 1 of A
  tap(45); // queue B while playing
  assert.match(e.addonStatus()[0], /pat A→B/);
  for (let i = 1; i < 6; i++) tick();
  hits.push(tick()); // tick 6: step 2 of A (empty)
  for (let i = 7; i < 12; i++) tick();
  hits.push(tick()); // tick 12: loop end -> B step 1
  for (let i = 13; i < 18; i++) tick();
  hits.push(tick()); // tick 18: B step 2
  assert.deepEqual(hits, [1, 0, 1, 1]);
  assert.match(e.addonStatus()[0], /pat B/);
});

test('xy fx: pads set two Live parameters, crosshair follows Live, spring returns', () => {
  const xyfx = require('../../addons/xyfx');
  const { e, out, clear } = setup((c) => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        Object.assign(c.pages[0].controls[`pad.${row}.${col}`], { type: 'addon', addon: { id: 'xyfx', action: 'xy', params: { track: 'FX', device: 'Auto Filter', xParam: 'Frequency', yParam: 'Resonance', col: String(col + 1), row: String(row + 1), spring: 'yes' } } });
      }
    }
  }, [xyfx]);
  const xKey = live.liveKey({ t: 'param', target: 'named', track: 'FX', device: 'Auto Filter', param: 'Frequency' });
  const yKey = live.liveKey({ t: 'param', target: 'named', track: 'FX', device: 'Auto Filter', param: 'Resonance' });
  e.handleLiveState({ type: 'live', key: xKey, ok: true, value: 0, name: 'Frequency', display: '20 Hz' });
  e.handleLiveState({ type: 'live', key: yKey, ok: true, value: 0, name: 'Resonance', display: '0 %' });
  clear();
  e.handlePushMessage([0x90, 36 + 2 * 8 + 7, 100]); // row 3, col 8 -> x = 1, y = 2/7
  const sets = out.live.filter((c) => c.cmd === 'liveSet');
  assert.deepEqual(sets.map((c) => [c.key, Math.round(c.value * 70) / 70]), [[xKey, 1], [yKey, 2 / 7]]);
  e.handleLiveState({ type: 'live', key: xKey, ok: true, value: 1, name: 'Frequency', display: '18 kHz' });
  e.handleLiveState({ type: 'live', key: yKey, ok: true, value: 2 / 7, name: 'Resonance', display: '29 %' });
  assert.match(e.addonStatus()[0], /XY Frequency 18 kHz · Resonance 29 %/);
  // Crosshair: pad (row 3, col 1) is on the line, (row 1, col 1) is off.
  const ledOf = (note) => out.push.filter((m) => (m[0] & 0xf0) === 0x90 && m[1] === note).at(-1);
  assert.equal(ledOf(36 + 16)[2], 45);
  clear();
  e.handlePushMessage([0x80, 36 + 2 * 8 + 7, 0]); // spring: back to 0 / 0
  assert.deepEqual(out.live.filter((c) => c.cmd === 'liveSet').map((c) => c.value), [0, 0]);
});

test('step sequencer: hold a pattern and press another = chain played in turn', () => {
  const stepseq = require('../../addons/stepseq');
  const { e, out, clear } = setup((c) => {
    const ctl = c.pages[0].controls;
    Object.assign(ctl['pad.0.0'], { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'C', lane: '1', step: '1', note: '36' } } });
    ['A', 'B', 'C'].forEach((slot, i) => Object.assign(ctl[`pad.1.${i}`], { type: 'addon', addon: { id: 'stepseq', action: 'pattern', params: { seq: 'C', slot } } }));
  }, [stepseq]);
  const tap = (note) => (e.handlePushMessage([0x90, note, 100]), e.handlePushMessage([0x80, note, 0]));
  // A: step on; B: empty; C: step on.
  tap(36);
  tap(46); // C
  tap(36);
  tap(44); // A
  e.handlePushMessage([0x90, 44, 100]); // hold A
  tap(46); // + C = chain A B C
  e.handlePushMessage([0x80, 44, 0]);
  assert.match(e.addonStatus()[0], /pat A \(ABC\)/);
  clear();
  e.handleHostMessage([0xfa]);
  const played = [];
  for (let i = 0; i < 24; i++) {
    const n = out.host.length;
    e.handleHostMessage([0xf8]);
    if (i % 6 === 0) played.push(out.host.slice(n).filter((m) => m[2] > 0).length);
  }
  // Loop length 1: A (hit), B (empty), C (hit), A (hit).
  assert.deepEqual(played, [1, 0, 1, 1]);
});
