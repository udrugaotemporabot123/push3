'use strict';
// Push 3 screen device script (p3um-screen.js, Max [js]) and the engine summary it draws.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Engine } = require('../src/engine');
const { defaultConfig } = require('../src/config');
const push3 = require('../src/push3');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'p3um-screen.js'), 'utf8');

function loadScreen() {
  const out = [];
  let tickFn = null;
  class Task {
    constructor(fn) {
      tickFn = fn;
    }
    repeat() {}
    cancel() {}
  }
  const fns = new Function('outlet', 'post', 'Task', `var autowatch, inlets, outlets;\n${SRC}\nreturn { start: start, screen: screen, enable: enable, test: test, notifydeleted: notifydeleted };`)(
    (n, ...a) => out.push([n, ...(Array.isArray(a[0]) ? a[0] : a)]),
    () => {},
    Task,
  );
  return { ...fns, out, tick: () => tickFn() };
}

test('screen script stays ES5 (Max [js])', () => {
  for (const [re, what] of [[/=>/, 'arrow functions'], [/\b(let|const)\s/, 'let/const'], [/`/, 'template strings'], [/\.\.\./, 'spread'], [/\bclass\s/, 'classes']]) {
    assert.ok(!re.test(SRC.replace(/\/\/.*$/gm, '')), `p3um-screen.js uses ${what}`);
  }
});

test('screen: draws only in User Mode, keeps the picture alive, hands the screen back when leaving', () => {
  const s = loadScreen();
  s.start();
  assert.deepEqual(s.out.at(-1), [2, 'bang']); // asks the Lite device for the summary
  const state = (mode) => JSON.stringify({ mode, track: { name: '6 - CHORDS', rgb: [255, 120, 0] }, rack: { name: '00 A1', rgb: [255, 63, 176] }, vars: { count: 12, selected: 6 }, racks: [{ label: 'ALL', rgb: [0, 80, 255], present: true, inUse: false }, { label: 'A1', rgb: [255, 63, 176], present: true, inUse: true }] });
  s.screen(state('live'));
  s.out.length = 0;
  s.tick();
  assert.equal(s.out.length, 0); // Live Mode: Live's own screen stays
  s.screen(state('user'));
  s.tick();
  const writes = s.out.filter((m) => m[0] === 0 && m[1] === 'write').map((m) => m[2]);
  assert.ok(writes.includes('6 - CHORDS') && writes.includes('00 A1') && writes.includes('VAR 7/12') && writes.includes('A1'));
  assert.deepEqual(s.out.at(-1), [0, 'bang']);
  s.out.length = 0;
  for (let i = 0; i < 5; i++) s.tick();
  assert.deepEqual(s.out, [[0, 'bang']]); // unchanged: only a keep-alive frame, no redraw
  s.out.length = 0;
  s.screen(state('live'));
  s.tick();
  assert.deepEqual(s.out, [[1, 'clear'], [1, 'bang']]); // transparent frame
  s.out.length = 0;
  s.test(1);
  s.tick();
  assert.ok(s.out.some((m) => m[1] === 'write' && m[2] === 'PUSH 3 EKRAN TEST'));
  s.enable(0);
  assert.deepEqual(s.out.slice(-2), [[1, 'clear'], [1, 'bang']]);
});

test('engine screen summary: track, rack row with the rack in use, variations', () => {
  const io = { toPush: () => {}, toHost: () => {}, toLive: () => {}, log: () => {}, now: () => 0, setTimer: () => 0, clearTimer: () => {}, setInterval: () => 1, clearInterval: () => {}, lite: true };
  const cfg = defaultConfig();
  cfg.pages[0].controls['pad.6.0'] = { type: 'live', label: 'ALL', colorOff: 45, live: { action: 'selectDevice', track: 'selected', device: '00 ALL' } };
  cfg.pages[0].controls['pad.6.1'] = { type: 'live', label: 'MIDI', colorOff: 5, live: { action: 'selectDevice', track: 'selected', device: '00 MIDI' } };
  const e = new Engine(io, cfg);
  e.handleLiveState({ type: 'visibleTracks', tracks: [{ id: 7, name: '5 - BASS', color: [10, 20, 30] }], selected: 7 });
  e.handleLiveState({ type: 'rackMap', tracks: { 7: [{ name: '00 midi bass', id: 71 }] } });
  e.handleLiveState({ type: 'variations', key: 'selected|selected', ok: true, count: 4, selected: 2, name: '00 MIDI bass', id: 71 });
  const s = e.screenState();
  assert.deepEqual(s.track, { name: '5 - BASS', rgb: [10, 20, 30] });
  assert.equal(s.rack.name, '00 MIDI bass');
  assert.deepEqual(s.vars, { count: 4, selected: 2 });
  assert.deepEqual(s.racks.map((r) => [r.label, r.present, r.inUse]), [['ALL', false, false], ['MIDI', true, true]]);
  assert.equal(s.racks[1].rgb.length, 3);
  assert.ok(push3.controls.length > 0);
});
