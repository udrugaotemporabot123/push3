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
