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
    { cmd: 'liveCall', spec: { t: 'clipToPad', source: 'MIC', scene: 2, target: 'DRUMS', rack: 'first', pad: 'next' }, fn: 'clipToPad' },
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
