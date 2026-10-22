'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../src/engine');
const { defaultConfig, normalizeConfig } = require('../src/config');
const push3 = require('../src/push3');

function setup(mutate) {
  const out = { push: [], host: [], live: [], logs: [] };
  const timers = [];
  const io = {
    toPush: (b) => out.push.push([...b]),
    toHost: (b) => out.host.push([...b]),
    toLive: (o) => out.live.push(o),
    log: (l, m) => out.logs.push(`${l}: ${m}`),
    now: () => 0,
    setTimer: (fn, ms) => timers.push(fn) - 1,
    clearTimer: (id) => {
      timers[id] = null;
    },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  const cfg = defaultConfig();
  if (mutate) mutate(cfg);
  const e = new Engine(io, cfg);
  e.setPushConnected(true);
  return { e, out, timers, clear: () => Object.keys(out).forEach((k) => (out[k].length = 0)) };
}

const SYSEX_USER = [...push3.SYSEX_HEADER, 0x0a, 0x01, 0xf7];
const SYSEX_LIVE = [...push3.SYSEX_HEADER, 0x0a, 0x00, 0xf7];
const sx = (...body) => [...push3.SYSEX_HEADER, ...body, 0xf7];

test('nothing is sent to Live or the Push while in Live Mode', () => {
  const { e, out } = setup();
  assert.equal(e.mode, 'live');
  e.handleHostMessage([0xb4, 60, 127]);
  assert.equal(out.push.length, 0);
});

test('mode sysex reply enters User Mode, paints LEDs and switches pads to poly aftertouch', () => {
  const { e, out, clear } = setup();
  e.handlePushMessage(SYSEX_USER);
  assert.equal(e.mode, 'user');
  // Asked for the current aftertouch mode first.
  assert.deepEqual(out.push.find((m) => m[0] === 0xf0), sx(0x1f));
  // Every pad got an LED message.
  const padLeds = out.push.filter((m) => m[0] === 0x90 && m[1] >= 36 && m[1] <= 99);
  assert.equal(padLeds.length, 64);
  // The User button LED is never touched.
  assert.ok(!out.push.some((m) => m[0] === 0xb0 && m[1] === 59));
  clear();
  // Push replies "MPE" -> we switch to poly pressure.
  e.handlePushMessage(sx(0x1f, 0x02));
  assert.deepEqual(out.push, [sx(0x1e, 0x01)]);
  clear();
  // Leaving restores MPE.
  e.handlePushMessage(SYSEX_LIVE);
  assert.equal(e.mode, 'live');
  assert.deepEqual(out.push, [sx(0x1e, 0x02)]);
});

test('missing aftertouch reply falls back to assuming MPE', () => {
  const { e, out, timers, clear } = setup();
  e.handlePushMessage(SYSEX_USER);
  clear();
  timers.filter(Boolean).forEach((fn) => fn());
  assert.deepEqual(out.push, [sx(0x1e, 0x01)]);
  clear();
  e.handlePushMessage(SYSEX_LIVE);
  assert.deepEqual(out.push, [sx(0x1e, 0x02)]);
});

test('activity on the User Port implies User Mode (engine started while already in User Mode)', () => {
  const { e } = setup();
  e.handlePushMessage([0x90, 36, 100]);
  assert.equal(e.mode, 'user');
});

test('startup "all notes off" does not count as User Mode activity', () => {
  const { e, out } = setup();
  e.handlePushMessage([0xb0, 123, 0]);
  e.handlePushMessage([0x80, 36, 0]);
  assert.equal(e.mode, 'live');
  assert.equal(out.push.length, 0);
});

test('User button is never translated', () => {
  const { e, out } = setup();
  e.handlePushMessage([0xb0, 59, 127]);
  assert.equal(e.mode, 'live');
  assert.equal(out.host.length, 0);
});

test('pads send clean notes on the page channel; MPE noise is dropped', () => {
  const { e, out, clear } = setup();
  e.handlePushMessage(SYSEX_USER);
  clear();
  // MPE style: note on member channel 3, pitch bend, slide, pressure on that channel.
  e.handlePushMessage([0x92, 36, 100]);
  e.handlePushMessage([0xe2, 0, 70]);
  e.handlePushMessage([0xb2, 74, 30]);
  e.handlePushMessage([0xd2, 50]);
  e.handlePushMessage([0x82, 36, 0]);
  // Page 1 channel = base channel 5 -> 0x94.
  assert.deepEqual(out.host, [
    [0x94, 36, 100],
    [0x94, 36, 0],
  ]);
});

test('pad pressure can be routed to a CC', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.0.0'], { pressure: 'cc', pressureCc: 20 });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0x90, 36, 90]);
  e.handlePushMessage([0xa0, 36, 40]);
  e.handlePushMessage([0xa0, 36, 40]); // duplicate is suppressed
  e.handlePushMessage([0xa0, 36, 41]);
  assert.deepEqual(out.host, [
    [0x94, 36, 90],
    [0xb4, 20, 40],
    [0xb4, 20, 41],
  ]);
});

test('toggle button sends on/off alternately and lights accordingly', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.mute, { behavior: 'toggle', colorOn: 5, colorOff: 7 });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 60, 127]);
  e.handlePushMessage([0xb0, 60, 0]);
  e.handlePushMessage([0xb0, 60, 127]);
  e.handlePushMessage([0xb0, 60, 0]);
  assert.deepEqual(out.host, [
    [0xb4, 60, 127],
    [0xb4, 60, 0],
  ]);
  const leds = out.push.filter((m) => m[0] === 0xb0 && m[1] === 60).map((m) => m[2]);
  assert.deepEqual(leds, [5, 7]); // diff cache: no repeats
});

test('feedback from Live updates toggle state and LED, also for hidden pages', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.solo, { behavior: 'toggle', colorOn: 13, colorOff: 15 });
    Object.assign(c.pages[1].controls.solo, { behavior: 'toggle', colorOn: 21, colorOff: 23 });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  // Live un-solos from somewhere else -> LED follows.
  e.handleHostMessage([0xb4, 61, 127]);
  assert.deepEqual(out.push.at(-1), [0xb0, 61, 13]);
  // Page 2 (channel 6) gets feedback while page 1 is visible: no LED now...
  clear();
  e.handleHostMessage([0xb5, 61, 127]);
  assert.equal(out.push.length, 0);
  // ...but it is lit when that page is shown.
  e.setPage(1);
  assert.ok(out.push.some((m) => m[0] === 0xb0 && m[1] === 61 && m[2] === 21));
  // And pressing it now toggles it OFF (state came from Live).
  clear();
  e.handlePushMessage([0xb0, 61, 127]);
  assert.deepEqual(out.host, [[0xb5, 61, 0]]);
});

test('momentary button: press/release and its own echo does not blink the LED off', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.play, { colorOn: 21, colorOff: 23 });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 85, 127]);
  e.handleHostMessage([0xb4, 85, 0]); // Live echo while held
  assert.deepEqual(out.push.filter((m) => m[1] === 85).map((m) => m[2]), [21]);
  e.handlePushMessage([0xb0, 85, 0]);
  assert.deepEqual(out.host, [
    [0xb4, 85, 127],
    [0xb4, 85, 0],
  ]);
  assert.deepEqual(out.push.filter((m) => m[1] === 85).map((m) => m[2]), [21, 23]);
});

test('trigger behaviour sends on and off immediately', () => {
  const { e, out, clear } = setup((c) => {
    c.pages[0].controls.tap.behavior = 'trigger';
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 3, 127]);
  e.handlePushMessage([0xb0, 3, 0]);
  assert.deepEqual(out.host, [
    [0xb4, 3, 127],
    [0xb4, 3, 0],
  ]);
});

test('radio group: turning one toggle on turns the others off', () => {
  const { e, out, clear } = setup((c) => {
    for (const id of ['scene.1', 'scene.2', 'scene.3']) Object.assign(c.pages[0].controls[id], { behavior: 'toggle', group: 'a' });
  });
  e.handlePushMessage(SYSEX_USER);
  e.handlePushMessage([0xb0, 36, 127]);
  e.handlePushMessage([0xb0, 36, 0]);
  clear();
  e.handlePushMessage([0xb0, 37, 127]);
  assert.deepEqual(out.host, [
    [0xb4, 36, 0],
    [0xb4, 37, 127],
  ]);
});

test('encoders: absolute mode with sensitivity and range; relative modes pass through', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['enc.1'], { sensitivity: 1, min: 0, max: 10 });
    Object.assign(c.pages[0].controls['enc.2'], { mode: 'relative2c' });
    Object.assign(c.pages[0].controls['enc.3'], { mode: 'relativeOffset' });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 71, 3]);
  e.handlePushMessage([0xb0, 71, 20]); // clamps at 10
  e.handlePushMessage([0xb0, 71, 127]); // -1
  e.handlePushMessage([0xb0, 72, 126]); // -2
  e.handlePushMessage([0xb0, 73, 5]);
  assert.deepEqual(out.host, [
    [0xb4, 71, 3],
    [0xb4, 71, 10],
    [0xb4, 71, 9],
    [0xb4, 72, 126],
    [0xb4, 73, 69],
  ]);
});

test('encoder absolute value follows feedback from Live (no jumps)', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['enc.1'], { sensitivity: 1 });
  });
  e.handlePushMessage(SYSEX_USER);
  e.handleHostMessage([0xb4, 71, 100]);
  clear();
  e.handlePushMessage([0xb0, 71, 1]);
  assert.deepEqual(out.host, [[0xb4, 71, 101]]);
});

test('upper display buttons select pages and light the current one', () => {
  const { e, out, clear } = setup();
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 103, 127]);
  assert.equal(e.page, 1);
  assert.equal(out.host.length, 0);
  // Pads now send on channel 6.
  clear();
  e.handlePushMessage([0x90, 40, 64]);
  assert.deepEqual(out.host, [[0x95, 40, 64]]);
});

test('switching page releases held notes (nothing stuck in Live)', () => {
  const { e, out, clear } = setup();
  e.handlePushMessage(SYSEX_USER);
  e.handlePushMessage([0x90, 50, 100]);
  clear();
  e.handlePushMessage([0xb0, 103, 127]);
  assert.deepEqual(out.host, [[0x94, 50, 0]]);
  // The late release does not send a second note off on the new page.
  clear();
  e.handlePushMessage([0x80, 50, 0]);
  assert.deepEqual(out.host, []);
});

test('leaving User Mode releases held notes', () => {
  const { e, out, clear } = setup();
  e.handlePushMessage(SYSEX_USER);
  e.handlePushMessage([0x90, 50, 100]);
  clear();
  e.handlePushMessage(SYSEX_LIVE);
  assert.deepEqual(out.host, [[0x94, 50, 0]]);
});

test('touch strip sends pitch bend on the page channel', () => {
  const { e, out, clear } = setup();
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xe0, 0x10, 0x50]);
  assert.deepEqual(out.host, [[0xe4, 0x10, 0x50]]);
});

test('unknown controls are collected for the editor', () => {
  const { e } = setup();
  e.handlePushMessage(SYSEX_USER);
  e.handlePushMessage([0xb0, 100, 127]);
  assert.equal(e.snapshot().discovered.length, 1);
});

test('variation pads talk to the Live bridge and light from its state', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.7.0'], { type: 'variation', target: { track: 'selected', device: 'first' }, index: 1, colorOn: 21, colorOff: 23 });
  });
  assert.deepEqual(out.live.find((x) => x.cmd === 'watch'), { cmd: 'watch', targets: { 'selected|first': { track: 'selected', device: 'first' } } });
  e.handlePushMessage(SYSEX_USER);
  e.handleLiveState({ type: 'variations', key: 'selected|first', ok: true, count: 3, selected: 1 });
  assert.deepEqual(out.push.filter((m) => m[1] === 92).at(-1), [0x90, 92, 21]);
  clear();
  e.handlePushMessage([0x90, 92, 100]);
  assert.deepEqual(out.live, [{ cmd: 'variation', key: 'selected|first', target: { track: 'selected', device: 'first' }, action: 'recall', index: 1 }]);
  assert.equal(out.host.length, 0);
  // Shift + pad stores.
  e.handlePushMessage([0x80, 92, 0]);
  e.handlePushMessage([0xb0, 49, 127]);
  clear();
  e.handlePushMessage([0x90, 92, 100]);
  assert.equal(out.live[0].action, 'store');
});

test('animated LEDs use the animation channel', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.record, { behavior: 'toggle', colorOn: 5, anim: 'blink' });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 86, 127]);
  const msgs = out.push.filter((m) => (m[0] & 0xf0) === 0xb0 && m[1] === 86);
  assert.deepEqual(msgs.at(-1), [0xb0 | push3.ANIMATIONS.blink, 86, 5]);
});

test('normalizeConfig survives garbage', () => {
  for (const bad of [null, 5, 'x', { pages: 'no' }, { pages: [null, { controls: { 'pad.0.0': { type: 'weird', number: 999 } } }] }]) {
    const c = normalizeConfig(bad);
    assert.ok(c.pages.length >= 1);
    for (const p of c.pages) assert.ok(p.controls['pad.0.0']);
  }
  const c = normalizeConfig({ pages: [{}, { controls: { 'pad.0.0': { type: 'weird', number: 999 } } }] });
  assert.equal(c.pages[1].controls['pad.0.0'].type, 'note');
  assert.equal(c.pages[1].controls['pad.0.0'].number, 127);
});

test('touch surfaces (D-pad note 13) are mappable; jog touch is note 11', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['dpad.touch'], { type: 'cc', number: 100, behavior: 'momentary' });
    Object.assign(c.pages[0].controls.jog, { touch: 'note', touchNumber: 5 });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0x90, 13, 127]);
  e.handlePushMessage([0x90, 13, 0]);
  e.handlePushMessage([0x90, 11, 127]);
  assert.deepEqual(out.host, [
    [0xb4, 100, 127],
    [0xb4, 100, 0],
    [0x94, 5, 127],
  ]);
  assert.equal(e.snapshot().discovered.length, 0);
});

test('shift layer: alternate mapping while Shift is held, with its own state and LEDs', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.mute, { behavior: 'toggle', colorOn: 5, colorOff: 7, shift: { type: 'cc', number: 90, behavior: 'toggle', colorOn: 45, colorOff: 47 } });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 49, 127]); // Shift down: consumed, LEDs switch to the shift layer
  assert.equal(out.host.length, 0);
  assert.deepEqual(out.push.filter((m) => m[1] === 60).at(-1), [0xb0, 60, 47]);
  e.handlePushMessage([0xb0, 60, 127]);
  e.handlePushMessage([0xb0, 60, 0]);
  assert.deepEqual(out.host, [[0xb4, 90, 127]]);
  assert.deepEqual(out.push.filter((m) => m[1] === 60).at(-1), [0xb0, 60, 45]);
  e.handlePushMessage([0xb0, 49, 0]); // Shift up: normal layer, still off
  assert.deepEqual(out.push.filter((m) => m[1] === 60).at(-1), [0xb0, 60, 7]);
  clear();
  e.handlePushMessage([0xb0, 60, 127]);
  assert.deepEqual(out.host, [[0xb4, 60, 127]]);
  // Feedback for the hidden shift layer updates its state without touching the visible LED.
  clear();
  e.handleHostMessage([0xb4, 90, 0]);
  assert.equal(out.push.length, 0);
  assert.equal(e.ctlState(0, 'mute', 's').on, false);
});

test('shift layer: releasing the control after Shift sends the matching note off', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.0.0'], { shift: { type: 'note', number: 10, behavior: 'momentary', velocity: 'fixed', onValue: 100 } });
  });
  e.handlePushMessage(SYSEX_USER);
  e.handlePushMessage([0xb0, 49, 127]);
  clear();
  e.handlePushMessage([0x90, 36, 60]);
  e.handlePushMessage([0xb0, 49, 0]);
  e.handlePushMessage([0x80, 36, 0]);
  assert.deepEqual(out.host, [
    [0x94, 10, 100],
    [0x94, 10, 0],
  ]);
});

test('page hold: shows a page only while held', () => {
  const { e } = setup((c) => {
    Object.assign(c.pages[0].controls.select, { type: 'pageHold', page: 2 });
  });
  e.handlePushMessage(SYSEX_USER);
  e.handlePushMessage([0xb0, 48, 127]);
  assert.equal(e.page, 2);
  e.handlePushMessage([0xb0, 48, 0]);
  assert.equal(e.page, 0);
});

test('config keeps shift mappings and drops empty ones', () => {
  const c = normalizeConfig({ pages: [{ controls: { mute: { type: 'cc', number: 60, shift: { type: 'cc', number: 300 } }, solo: { type: 'cc', number: 61, shift: { type: 'none' } } } }] });
  assert.equal(c.pages[0].controls.mute.shift.number, 127);
  assert.equal(c.pages[0].controls.solo.shift, undefined);
});

test('live controls: mute toggles via the Live API and lights in the track colour', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['lower.1'], { type: 'live', live: { action: 'mute', track: 'Bass' }, colorOff: 1 });
  });
  const watch = out.live.find((x) => x.cmd === 'watchLive');
  const key = Object.keys(watch.targets)[0];
  assert.deepEqual(watch.targets[key], { t: 'trackProp', track: 'Bass', prop: 'mute' });
  e.handlePushMessage(SYSEX_USER);
  e.handleLiveState({ type: 'live', key, ok: true, value: 0, name: 'Bass', color: [255, 0, 0] });
  assert.deepEqual(out.push.filter((m) => m[1] === 20).at(-1), [0xb0, 20, 1]);
  clear();
  e.handlePushMessage([0xb0, 20, 127]);
  assert.deepEqual(out.live, [{ cmd: 'liveSet', key, spec: { t: 'trackProp', track: 'Bass', prop: 'mute' }, value: 1 }]);
  assert.equal(out.host.length, 0);
  e.handlePushMessage([0xb0, 20, 0]);
  e.handleLiveState({ type: 'live', key, ok: true, value: 1, name: 'Bass', color: [255, 0, 0] });
  assert.deepEqual(out.push.filter((m) => m[1] === 20).at(-1), [0xb0, 20, 5]); // nearest bright red
});

test('live encoders send normalised values and accumulate fast turns', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['enc.1'], { type: 'live', sensitivity: 1, live: { target: 'volume', track: 'selected' } });
  });
  const key = Object.keys(out.live.find((x) => x.cmd === 'watchLive').targets)[0];
  e.handlePushMessage(SYSEX_USER);
  e.handleLiveState({ type: 'live', key, ok: true, value: 0.5, name: 'Volume', display: '0.0 dB' });
  clear();
  e.handlePushMessage([0xb0, 71, 2]);
  e.handlePushMessage([0xb0, 71, 2]);
  assert.equal(out.live.length, 2);
  assert.ok(Math.abs(out.live[1].value - (0.5 + 4 / 127)) < 1e-9);
  assert.equal(out.host.length, 0);
});

test('transport live actions call the bridge', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.tap, { type: 'live', live: { action: 'tap' } });
    Object.assign(c.pages[0].controls['scene.1'], { type: 'live', live: { action: 'scene', scene: 3 } });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 3, 127]);
  e.handlePushMessage([0xb0, 36, 127]);
  assert.deepEqual(out.live, [
    { cmd: 'liveCall', spec: { t: 'song' }, fn: 'tap' },
    { cmd: 'liveCall', spec: { t: 'scene', index: 3 }, fn: 'fire' },
  ]);
});

test('live param button: momentary sets 1 on press and 0 on release; toggle follows Live', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.0.0'], { type: 'live', live: { action: 'param', track: 'MIC', device: 'Record.To.Simpler', param: 'Record', mode: 'momentary' } });
    Object.assign(c.pages[0].controls['pad.0.1'], { type: 'live', live: { action: 'param', track: 'VIO', device: 'Beat Repeat', param: 'Device On', mode: 'toggle' } });
  });
  e.handlePushMessage(SYSEX_USER);
  const watch = out.live.filter((x) => x.cmd === 'watchLive').at(-1).targets;
  const keyToggle = Object.keys(watch).find((k) => k.includes('Beat Repeat'));
  e.handleLiveState({ type: 'live', key: keyToggle, ok: true, value: 1 });
  clear();
  e.handlePushMessage([0x90, 36, 100]);
  e.handlePushMessage([0x80, 36, 0]);
  e.handlePushMessage([0x90, 37, 100]);
  assert.deepEqual(out.live.map((x) => x.value), [1, 0, 0]);
  assert.equal(out.live[2].spec.param, 'Device On');
});

test('clip slot pads: launch via bridge, LED follows slot state with clip colour', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.7.0'], { type: 'live', colorOff: 1, live: { action: 'clip', track: '1', scene: 1 } });
  });
  e.handlePushMessage(SYSEX_USER);
  const key = Object.keys(out.live.filter((x) => x.cmd === 'watchLive').at(-1).targets)[0];
  e.handleLiveState({ type: 'live', key, ok: true, value: 0 });
  assert.deepEqual(out.push.filter((m) => (m[0] & 0xf0) === 0x90 && m[1] === 92).at(-1), [0x90, 92, 1]);
  e.handleLiveState({ type: 'live', key, ok: true, value: 2, color: [0, 0, 255] });
  const last = out.push.filter((m) => (m[0] & 0xf0) === 0x90 && m[1] === 92).at(-1);
  assert.equal(last[0], 0x90 | push3.ANIMATIONS.pulse);
  e.handleLiveState({ type: 'live', key, ok: true, value: 3, color: [0, 0, 255] });
  assert.deepEqual(out.push.filter((m) => (m[0] & 0xf0) === 0x90 && m[1] === 92).at(-1), [0x90 | push3.ANIMATIONS.blink, 92, 5]);
  clear();
  e.handlePushMessage([0x90, 92, 100]);
  assert.deepEqual(out.live, [{ cmd: 'liveCall', spec: { t: 'slot', track: '1', scene: 1 }, fn: 'fireSlot' }]);
});

test('Shift + encoder turns 10x finer when the encoder has no shift mapping', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['enc.1'], { sensitivity: 1 });
  });
  e.handlePushMessage(SYSEX_USER);
  e.handleHostMessage([0xb4, 71, 50]);
  e.handlePushMessage([0xb0, 49, 127]);
  clear();
  for (let i = 0; i < 10; i++) e.handlePushMessage([0xb0, 71, 1]);
  assert.deepEqual(out.host, [[0xb4, 71, 51]]);
});

test('velocity curves and panic', () => {
  const { applyCurve } = require('../src/engine');
  assert.ok(applyCurve(64, 'soft') > 64);
  assert.ok(applyCurve(64, 'hard') < 64);
  assert.equal(applyCurve(64, 'linear'), 64);
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.delete, { type: 'panic' });
  });
  e.handlePushMessage(SYSEX_USER);
  e.handlePushMessage([0x90, 40, 90]);
  clear();
  e.handlePushMessage([0xb0, 118, 127]);
  assert.deepEqual(out.host[0], [0x94, 40, 0]);
  assert.equal(out.host.filter((m) => m[1] === 123).length, 16);
});

test('touch strip and pad pressure can drive Live parameters directly', () => {
  const { e, out, clear } = setup((c) => {
    c.pages[0].controls.strip = { type: 'live', live: { target: 'macro', track: 'VIO', device: 'first', index: 1 } };
    Object.assign(c.pages[0].controls['pad.0.0'], { pressure: 'live', pressureLive: { target: 'named', track: 'VIO', device: 'Auto Filter', param: 'Frequency' } });
  });
  e.handlePushMessage(SYSEX_USER);
  const targets = out.live.filter((x) => x.cmd === 'watchLive').at(-1).targets;
  assert.ok(Object.values(targets).some((t) => t.param === 'Frequency'));
  clear();
  e.handlePushMessage([0xe0, 0x7f, 0x7f]); // strip at the top
  e.handlePushMessage([0xe0, 0x7f, 0x7f]); // duplicate skipped
  e.handlePushMessage([0x90, 36, 80]);
  e.handlePushMessage([0xa0, 36, 127]);
  e.handlePushMessage([0x80, 36, 0]);
  const vals = out.live.filter((x) => x.cmd === 'liveSet').map((x) => [x.spec.target, x.value]);
  assert.deepEqual(vals, [
    ['macro', 1],
    ['named', 1],
    ['named', 0],
  ]);
});

test('encoder steps mode fires up/down triggers every N detents', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.jog, { mode: 'steps', stepType: 'cc', upNumber: 101, downNumber: 100, stepSize: 2 });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 70, 1]);
  assert.equal(out.host.length, 0);
  e.handlePushMessage([0xb0, 70, 1]);
  e.handlePushMessage([0xb0, 70, 127]);
  e.handlePushMessage([0xb0, 70, 127]);
  assert.deepEqual(out.host, [
    [0xb4, 101, 127],
    [0xb4, 101, 0],
    [0xb4, 100, 127],
    [0xb4, 100, 0],
  ]);
});

test('extra messages are sent together with the main one', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls.mute, { behavior: 'toggle', extra: [{ type: 'cc', number: 20, channel: 0 }, { type: 'note', number: 60, channel: 2 }] });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 60, 127]);
  assert.deepEqual(out.host, [
    [0xb4, 60, 127],
    [0xb4, 20, 127],
    [0x91, 60, 127],
  ]);
});

test('14-bit encoder: MSB + LSB out, Shift reaches single steps, feedback from both CCs', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['enc.1'], { mode: 'absolute14', number: 20, sensitivity: 1 });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 71, 1]); // +1 detent = 128 units
  assert.deepEqual(out.host, [[0xb4, 20, 1], [0xb4, 52, 0]]);
  clear();
  e.handlePushMessage([0xb0, 49, 127]); // shift
  e.handlePushMessage([0xb0, 71, 1]); // fine: +12.8 -> 141
  e.handlePushMessage([0xb0, 49, 0]);
  assert.deepEqual(out.host, [[0xb4, 20, 1], [0xb4, 52, 13]]);
  // Feedback: MSB then LSB from Live.
  e.handleHostMessage([0xb4, 20, 100]);
  e.handleHostMessage([0xb4, 52, 5]);
  assert.equal(e.ctlState(0, 'enc.1').value, 100 * 128 + 5);
  // Normalisation keeps the MSB in 0-31.
  const { normalizeConfig } = require('../src/config');
  const cfg = normalizeConfig({ pages: [{ controls: { 'enc.2': { type: 'cc', mode: 'absolute14', number: 72 } } }] });
  assert.equal(cfg.pages[0].controls['enc.2'].number, 31);
});

test('editing a toggled-on note mapping sends its note off (no stuck notes)', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.0.0'], { type: 'note', number: 40, behavior: 'toggle' });
  });
  e.handlePushMessage(SYSEX_USER);
  e.handlePushMessage([0x90, 36, 100]);
  e.handlePushMessage([0x80, 36, 0]);
  clear();
  const cfg = JSON.parse(JSON.stringify(e.config));
  e.setConfig(cfg); // unchanged: the toggle stays on
  assert.deepEqual(out.host, []);
  cfg.pages[0].controls['pad.0.0'].number = 41;
  e.setConfig(cfg);
  assert.deepEqual(out.host, [[0x94, 40, 0]]);
  assert.equal(e.ctlState(0, 'pad.0.0').on, false);
});

test('switching an encoder between 7-bit and 14-bit starts from a fresh value (no jump)', () => {
  const { e, out, clear } = setup();
  e.handlePushMessage(SYSEX_USER);
  e.handleHostMessage([0xb4, 71, 100]); // Live says 100 (7-bit)
  const cfg = JSON.parse(JSON.stringify(e.config));
  Object.assign(cfg.pages[0].controls['enc.1'], { mode: 'absolute14', number: 20 });
  e.setConfig(cfg);
  assert.equal(e.ctlState(0, 'enc.1').value, null);
  clear();
  e.handleHostMessage([0xb4, 20, 64]);
  assert.equal(e.ctlState(0, 'enc.1').value, 64 * 128);
});

test('page state follows its page when pages are moved or deleted (stable uid)', () => {
  const { e } = setup((c) => {
    c.pages.push(JSON.parse(JSON.stringify(c.pages[0])));
    c.pages[1].name = 'Two';
    Object.assign(c.pages[1].controls['pad.0.0'], { type: 'cc', number: 20, behavior: 'toggle' });
  });
  e.handlePushMessage(SYSEX_USER);
  const last = e.config.pages.length - 1;
  assert.notEqual(e.config.pages[0].uid, e.config.pages[last].uid); // the copied page got its own uid
  e.setPage(1);
  e.handlePushMessage([0x90, 36, 100]); // toggle on, page "Two"
  e.handlePushMessage([0x80, 36, 0]);
  const cfg = JSON.parse(JSON.stringify(e.config));
  [cfg.pages[0], cfg.pages[1]] = [cfg.pages[1], cfg.pages[0]]; // move "Two" to the front
  e.setConfig(cfg);
  assert.equal(e.config.pages[0].name, 'Two');
  assert.equal(e.page, 0); // still showing "Two"
  assert.equal(e.ctlState(0, 'pad.0.0').on, true);
  assert.equal(e.ctlState(1, 'pad.0.0').on, false);
  cfg.pages.splice(1, 1); // delete a page after it
  e.setConfig(cfg);
  assert.equal(e.ctlState(0, 'pad.0.0').on, true);
});

test('transpose buttons move pad notes per page; note offs match the note that was sent', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.0.0'], { type: 'note', number: 48, behavior: 'momentary', velocity: 'fixed', onValue: 100 });
    Object.assign(c.pages[0].controls.octUp, { type: 'transpose', amount: 12 });
    Object.assign(c.pages[0].controls.octDown, { type: 'transpose', amount: -12 });
  });
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0x90, 36, 100]); // pad held at 48
  e.handlePushMessage([0xb0, 55, 127]); // Oct + while holding
  e.handlePushMessage([0xb0, 55, 0]);
  e.handlePushMessage([0x80, 36, 0]); // off goes to 48, not 60
  e.handlePushMessage([0x90, 36, 100]);
  e.handlePushMessage([0x80, 36, 0]);
  assert.deepEqual(out.host, [[0x94, 48, 100], [0x94, 48, 0], [0x94, 60, 100], [0x94, 60, 0]]);
  e.setPage(1);
  clear();
  e.handlePushMessage([0x90, 36, 100]); // other page: not transposed
  assert.equal(out.host[0][1], 36);
});

test('note repeat: held pads retrigger on the clock grid, pressure sets the velocity', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.0.0'], { type: 'note', number: 36, behavior: 'momentary', velocity: 'fixed', onValue: 100 });
    Object.assign(c.pages[0].controls.repeat, { type: 'repeat', rate: '1/8', behavior: 'momentary' });
  });
  e.handlePushMessage(SYSEX_USER);
  e.handleHostMessage([0xfa]);
  e.handleHostMessage([0xf8]);
  e.handleHostMessage([0xf8]); // tick 2: pad pressed mid-grid
  e.handlePushMessage([0xb0, 56, 127]); // hold Repeat
  clear();
  e.handlePushMessage([0x90, 36, 100]);
  for (let i = 3; i <= 12; i++) e.handleHostMessage([0xf8]); // tick 12 = next 1/8
  e.handlePushMessage([0xa0, 36, 60]); // press softer
  for (let i = 13; i <= 24; i++) e.handleHostMessage([0xf8]);
  e.handlePushMessage([0x80, 36, 0]);
  for (let i = 25; i <= 36; i++) e.handleHostMessage([0xf8]); // released: no more
  const notes = out.host.filter((m) => (m[0] & 0xf0) === 0x90);
  assert.deepEqual(notes, [[0x94, 36, 100], [0x94, 36, 0], [0x94, 36, 100], [0x94, 36, 0], [0x94, 36, 60], [0x94, 36, 0]]);
  e.handlePushMessage([0xb0, 56, 0]); // Repeat released: pads play normally again
  clear();
  e.handlePushMessage([0x90, 36, 100]);
  for (let i = 0; i < 24; i++) e.handleHostMessage([0xf8]);
  assert.equal(out.host.filter((m) => (m[0] & 0xf0) === 0x90).length, 1);
});

test('accent plays pads at full velocity; snapshots store and recall encoder values', () => {
  let saved = null;
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['pad.0.0'], { type: 'note', number: 36, behavior: 'momentary', velocity: 'dynamic' });
    Object.assign(c.pages[0].controls.accent, { type: 'accent', behavior: 'momentary' });
    Object.assign(c.pages[0].controls['scene.1'], { type: 'snapshot', slot: 1 });
  });
  e.io.saveAddonState = (id, data) => (saved = [id, JSON.parse(JSON.stringify(data))]);
  e.handlePushMessage(SYSEX_USER);
  clear();
  e.handlePushMessage([0xb0, 57, 127]); // hold Accent
  e.handlePushMessage([0x90, 36, 30]);
  e.handlePushMessage([0x80, 36, 0]);
  e.handlePushMessage([0xb0, 57, 0]);
  e.handlePushMessage([0x90, 36, 30]);
  assert.deepEqual(out.host.filter((m) => m[2] > 0).map((m) => m[2]), [127, out.host.filter((m) => m[2] > 0)[1][2]]);
  assert.ok(out.host.filter((m) => m[2] > 0)[1][2] < 127);
  // Encoder 1 at 40, store in slot 1, move to 90, recall: 40 is sent again.
  e.handleHostMessage([0xb4, 71, 40]);
  e.handlePushMessage([0xb0, 36, 127]); // scene.1: empty slot -> store
  e.handlePushMessage([0xb0, 36, 0]);
  assert.equal(saved[0], 'core-snapshots');
  e.handleHostMessage([0xb4, 71, 90]);
  clear();
  e.handlePushMessage([0xb0, 36, 127]); // recall
  assert.deepEqual(out.host, [[0xb4, 71, 40]]);
  assert.equal(e.ctlState(0, 'enc.1').value, 40);
});

test('touch strip morph blends encoders between two snapshots', () => {
  const { e, out, clear } = setup((c) => {
    Object.assign(c.pages[0].controls['scene.1'], { type: 'snapshot', slot: 1 });
    Object.assign(c.pages[0].controls['scene.2'], { type: 'snapshot', slot: 2 });
    c.pages[0].controls.strip = { type: 'morph', slotA: 1, slotB: 2 };
  });
  e.handlePushMessage(SYSEX_USER);
  e.handleHostMessage([0xb4, 71, 0]);
  e.handlePushMessage([0xb0, 36, 127]); // store A (enc 1 = 0)
  e.handleHostMessage([0xb4, 71, 100]);
  e.handlePushMessage([0xb0, 37, 127]); // store B (enc 1 = 100)
  clear();
  e.handlePushMessage([0xe0, 0, 64]); // strip in the middle (8192)
  assert.deepEqual(out.host.filter((m) => m[0] === 0xb4 && m[1] === 71), [[0xb4, 71, 50]]);
});

test('review fixes: transposed aftertouch, no empty snapshots, morph reaches B in Fader mode, accent stays on its page', () => {
  let saved = null;
  const { e, out, clear } = setup((c) => {
    c.settings.stripFader = true;
    Object.assign(c.pages[0].controls['pad.0.0'], { type: 'note', number: 36, behavior: 'momentary', velocity: 'dynamic', pressure: 'polyAT' });
    Object.assign(c.pages[0].controls.octUp, { type: 'transpose', amount: 12 });
    Object.assign(c.pages[0].controls.accent, { type: 'accent', behavior: 'toggle' });
    Object.assign(c.pages[0].controls['scene.1'], { type: 'snapshot', slot: 1 });
    Object.assign(c.pages[0].controls['scene.2'], { type: 'snapshot', slot: 2 });
    c.pages[0].controls.strip = { type: 'morph', slotA: 1, slotB: 2 };
    Object.assign(c.pages[1].controls['pad.0.0'], { type: 'note', number: 36, behavior: 'momentary', velocity: 'dynamic' });
  });
  e.io.saveAddonState = (id, data) => (saved = JSON.parse(JSON.stringify(data)));
  e.handlePushMessage(SYSEX_USER);
  // 1. Aftertouch goes to the transposed note.
  e.handlePushMessage([0xb0, 55, 127]);
  clear();
  e.handlePushMessage([0x90, 36, 100]);
  e.handlePushMessage([0xa0, 36, 80]);
  e.handlePushMessage([0x80, 36, 0]);
  assert.deepEqual(out.host.find((m) => (m[0] & 0xf0) === 0xa0), [0xa4, 48, 80]);
  // 2. Nothing to store yet: no empty snapshot is saved.
  e.handlePushMessage([0xb0, 36, 127]);
  e.handlePushMessage([0xb0, 36, 0]);
  assert.equal(saved, null);
  // 3. Morph in Fader mode: the top of the strip is exactly snapshot B.
  e.handleHostMessage([0xb4, 71, 0]);
  e.handlePushMessage([0xb0, 36, 127]);
  e.handleHostMessage([0xb4, 71, 127]);
  e.handlePushMessage([0xb0, 37, 127]);
  e.handlePushMessage([0xe0, 0, 64]); // middle
  clear();
  e.handlePushMessage([0xe0, 127, 127]); // top (Fader mode sends 7 bits)
  assert.deepEqual(out.host.filter((m) => m[0] === 0xb4 && m[1] === 71).at(-1), [0xb4, 71, 127]);
  // 4. Latched accent on page 1 does not touch page 2.
  e.handlePushMessage([0xb0, 57, 127]);
  e.setPage(1);
  clear();
  e.handlePushMessage([0x90, 36, 40]);
  assert.ok(out.host[0][2] < 127);
});
