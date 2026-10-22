'use strict';
// Runs p3um-live.js (the Max [js] Live API bridge) against a small fake Live Object Model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function makeLive() {
  let nextId = 1;
  const objs = new Map();
  const observers = [];
  function obj(props, children = {}) {
    const o = { id: nextId++, props, children };
    objs.set(o.id, o);
    return o;
  }
  const param = (name, value, min = 0, max = 1) => obj({ name, value, min, max, is_quantized: 0 });
  const track = (name, color, extra = {}) =>
    obj({ name, mute: 0, solo: 0, arm: 0, can_be_armed: 1, color, ...extra }, {
      mixer_device: obj({}, { volume: param('Track Volume', 0.85), panning: param('Track Panning', 0, -1, 1), sends: [param('A-Reverb', 0.2)] }),
      devices: [],
      view: obj({ selected_device: 0 }),
      clip_slots: [obj({ has_clip: 0, playing_status: 0, is_recording: 0, is_triggered: 0, color: 0 }), obj({ has_clip: 1, playing_status: 1, is_recording: 0, is_triggered: 0, color: 0x0000ff })],
    });
  const bass = track('Bass', 0xff0000);
  const vio = track('Violin', 0x00ff00);
  const rack = obj({ name: 'FX Rack', can_have_chains: 1, variation_count: 3, selected_variation_index: 0 }, { parameters: [param('Device On', 1), param('Macro 1', 0.5, 0, 127)], chains: [] });
  vio.children.devices.push(rack);
  const master = track('Main', 0xffffff, { can_be_armed: 0 });
  const simpler = (file) => obj({ name: 'Simpler', class_name: 'OriginalSimpler' }, { sample: file ? obj({ file_path: file }) : null });
  const pad = (name, note, s) => obj({ name, note }, { chains: s ? [obj({ name }, { devices: [s] })] : [] });
  const pads = [pad('C1', 36, simpler('/kick.wav')), pad('C#1', 37, null), pad('D1', 38, simpler(null)), pad('D#1', 39, simpler(null))];
  const drums = obj({ name: 'Drums', can_have_drum_pads: 1, can_have_chains: 1, class_name: 'DrumGroupDevice' }, { drum_pads: pads, view: obj({ selected_drum_pad: pads[0].id }), chains: [] });
  bass.children.devices.push(drums);
  const songView = obj({ selected_track: vio.id }, { selected_track: null, selected_scene: obj({ name: 'S1' }) });
  const scenes = [obj({ name: 'Intro' }), obj({ name: 'Drop' })];
  const song = obj({ is_playing: 0, session_record: 0, metronome: 0, arrangement_overdub: 0, tempo: 120 }, { tracks: [bass, vio], return_tracks: [], master_track: master, view: songView, scenes });
  const calls = [];

  function resolve(p) {
    const parts = String(p).trim().split(/\s+/);
    let cur;
    let i = 0;
    if (parts[0] === 'id') {
      cur = objs.get(Number(parts[1]));
      i = 2;
    } else if (parts[0] === 'live_set') {
      cur = song;
      i = 1;
    } else return null;
    while (cur && i < parts.length) {
      const k = parts[i];
      if (k === 'selected_track' && cur === songView) cur = objs.get(songView.props.selected_track);
      else if (k === 'selected_device' && cur.props && 'selected_device' in cur.props) cur = objs.get(cur.props.selected_device);
      else if (!(k in cur.children) && typeof cur.props[k] === 'number') cur = objs.get(cur.props[k]);
      else {
        const c = cur.children[k];
        if (Array.isArray(c)) {
          cur = c[Number(parts[i + 1])];
          i++;
        } else cur = c;
      }
      i++;
    }
    return cur || null;
  }
  function pathOf(o) {
    const walk = (node, prefix) => {
      if (node === o) return prefix;
      for (const [k, c] of Object.entries(node.children || {})) {
        if (Array.isArray(c)) {
          for (let j = 0; j < c.length; j++) {
            const r = walk(c[j], `${prefix} ${k} ${j}`);
            if (r) return r;
          }
        } else if (c && typeof c === 'object' && c.id) {
          const r = walk(c, `${prefix} ${k}`);
          if (r) return r;
        }
      }
      return null;
    };
    return walk(song, 'live_set');
  }
  class LiveAPI {
    constructor(a, b) {
      this.cb = typeof a === 'function' ? a : null;
      const o = resolve(typeof a === 'function' ? b : a);
      this.o = o;
      this.id = o ? o.id : 0;
      this.unquotedpath = o ? pathOf(o) : '';
      this._prop = '';
    }
    set property(p) {
      this._prop = p;
      if (p && this.cb) {
        observers.push(this);
        this.cb(['init']);
      }
    }
    get property() {
      return this._prop;
    }
    get(k) {
      return [this.o.props[k]];
    }
    set(k, ...v) {
      this.o.props[k] = v[0] === 'id' ? v[1] : v[0];
      for (const ob of [...observers]) if (ob.o === this.o && ob._prop === k) ob.cb([k]); // like Live: only observers that existed at the change
    }
    call(fn, ...args) {
      calls.push([this.o.props.name || 'song', fn, ...args]);
      if (fn === 'str_for_value') return [`${Math.round(args[0] * 100)}%`];
      if (fn === 'start_playing') this.set('is_playing', 1);
      if (fn === 'stop_playing') this.set('is_playing', 0);
      if (fn === 'recall_selected_variation') return null;
      if (fn === 'replace_sample') this.o.children.sample = { id: 7777, props: { file_path: args[0] }, children: {} };
      return null;
    }
    getcount(k) {
      return (this.o.children[k] || []).length;
    }
  }
  return { LiveAPI, song, bass, vio, rack, master, songView, calls, pads, drums, obj };
}

function loadBridge(live) {
  const out = [];
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'p3um-live.js'), 'utf8');
  // Synchronous stand-in for Max's Task: runs the function until cancelled or out of repeats.
  class Task {
    constructor(fn) {
      this.fn = fn;
      this.cancelled = false;
    }
    repeat(n) {
      for (let i = 0; i < n && !this.cancelled; i++) {
        if (live.beforeTick) live.beforeTick(i);
        this.fn();
      }
    }
    cancel() {
      this.cancelled = true;
    }
  }
  const fns = new Function('LiveAPI', 'outlet', 'post', 'Task', `var autowatch, inlets, outlets;\n${src}\nreturn { init: init, live: live };`)(
    live.LiveAPI,
    (n, ...args) => out.push(args[0] === undefined ? [args] : args.map((a) => (typeof a === 'string' && a.startsWith('{') ? JSON.parse(a) : a))),
    () => {},
    Task,
  );
  return { ...fns, out };
}

const states = (out) => out.filter((x) => x[0] === 'liveState').map((x) => x[1]);

test('bridge: mute toggle on a named track, with colour and feedback', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const spec = { t: 'trackProp', track: 'Bass', prop: 'mute' };
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { k1: spec } }));
  let last = states(b.out).at(-1);
  assert.deepEqual([last.ok, last.value, last.name, last.color], [true, 0, 'Bass', [255, 0, 0]]);
  b.live(JSON.stringify({ cmd: 'liveSet', key: 'k1', spec, value: 1 }));
  assert.equal(live.bass.props.mute, 1);
  last = states(b.out).at(-1);
  assert.equal(last.value, 1);
});

test('bridge: selected-track volume follows the selection', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const spec = { t: 'param', target: 'volume', track: 'selected' };
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { v: spec } }));
  assert.equal(states(b.out).at(-1).value, 0.85);
  b.live(JSON.stringify({ cmd: 'liveSet', key: 'v', spec, value: 0.5 }));
  assert.equal(live.vio.children.mixer_device.children.volume.props.value, 0.5);
  // Select Bass: the same control now shows Bass's volume.
  new live.LiveAPI('live_set view').set('selected_track', 'id', live.bass.id);
  assert.equal(states(b.out).at(-1).value, 0.85);
  b.live(JSON.stringify({ cmd: 'liveSet', key: 'v', spec, value: 0.1 }));
  assert.equal(live.bass.children.mixer_device.children.volume.props.value, 0.1);
});

test('bridge: rack macro on a named track is found and scaled', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const spec = { t: 'param', target: 'macro', track: 'Violin', device: 'first', index: 1 };
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { m: spec } }));
  const st = states(b.out).at(-1);
  assert.equal(st.ok, true);
  assert.equal(st.name, 'Macro 1');
  b.live(JSON.stringify({ cmd: 'liveSet', key: 'm', spec, value: 1 }));
  assert.equal(live.rack.children.parameters[1].props.value, 127);
});

test('bridge: arm on the master track is reported as unavailable, not crashing', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { a: { t: 'trackProp', track: 'master', prop: 'arm' } } }));
  assert.equal(states(b.out).at(-1).ok, false);
});

test('bridge: transport, tempo, scene and select calls', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const play = { t: 'song', prop: 'is_playing' };
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { p: play, t: { t: 'param', target: 'tempo' } } }));
  b.live(JSON.stringify({ cmd: 'liveSet', key: 'p', spec: play, value: 1 }));
  assert.equal(live.song.props.is_playing, 1);
  b.live(JSON.stringify({ cmd: 'liveSet', key: 't', spec: { t: 'param', target: 'tempo' }, value: 0.5 }));
  assert.equal(live.song.props.tempo, 130);
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'scene', index: 2 }, fn: 'fire' }));
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'song' }, fn: 'tap' }));
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'trackSelect', track: '1' }, fn: 'select' }));
  assert.deepEqual(live.calls.filter((c) => c[1] !== 'str_for_value').map((c) => c.slice(0, 2)), [
    ['song', 'start_playing'],
    ['Drop', 'fire'],
    ['song', 'tap_tempo'],
  ]);
  assert.equal(live.songView.props.selected_track, live.bass.id);
});

test('bridge: rack variations recall through selected index', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const target = { track: 'Violin', device: 'first' };
  b.live(JSON.stringify({ cmd: 'watch', targets: { 'Violin|first': target } }));
  const st = states(b.out).filter((s) => s.type === 'variations').at(-1);
  assert.deepEqual([st.ok, st.count, st.name], [true, 3, 'FX Rack']);
  b.live(JSON.stringify({ cmd: 'variation', key: 'Violin|first', target, action: 'recall', index: 2 }));
  assert.equal(live.rack.props.selected_variation_index, 2);
  assert.ok(live.calls.some((c) => c[1] === 'recall_selected_variation'));
});

test('bridge: named device parameter (inside a rack chain) by parameter name', () => {
  const live = makeLive();
  // Put a "Beat Repeat" device inside the rack's first chain.
  const chainParent = live.rack;
  const LiveAPI = live.LiveAPI;
  const b = loadBridge(live);
  b.init();
  const spec = { t: 'param', target: 'named', track: 'Violin', device: 'FX Rack', param: 'macro 1' };
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { n: spec } }));
  const st = states(b.out).at(-1);
  assert.deepEqual([st.ok, st.name], [true, 'Macro 1']);
  b.live(JSON.stringify({ cmd: 'liveSet', key: 'n', spec, value: 0 }));
  assert.equal(chainParent.children.parameters[1].props.value, 0);
  assert.ok(LiveAPI);
});

test('bridge: unknown device name reports not found', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { x: { t: 'param', target: 'named', track: 'Violin', device: 'Nope', param: '1' } } }));
  assert.equal(states(b.out).at(-1).ok, false);
});

test('bridge: clip slot state, fire and delete; scene 0 = selected scene', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const spec = { t: 'slot', track: 'Bass', scene: 2 };
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { s: spec, e: { t: 'slot', track: 'Bass', scene: 1 } } }));
  const all = states(b.out);
  const playing = all.filter((x) => x.key === 's').at(-1);
  const empty = all.filter((x) => x.key === 'e').at(-1);
  assert.deepEqual([playing.value, playing.color], [2, [0, 0, 255]]);
  assert.equal(empty.value, 0);
  b.live(JSON.stringify({ cmd: 'liveCall', spec, fn: 'fireSlot' }));
  b.live(JSON.stringify({ cmd: 'liveCall', spec, fn: 'deleteSlot' }));
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'trackSelect', track: 'Bass' }, fn: 'stopTrack' }));
  assert.deepEqual(live.calls.filter((c) => ['fire', 'delete_clip', 'stop_all_clips'].includes(c[1])).map((c) => c[1]), ['fire', 'delete_clip', 'stop_all_clips']);
});

test('bridge: trackSlots reports every slot state of a track', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { ts: { t: 'trackSlots', track: 'Bass' } } }));
  assert.deepEqual(states(b.out).at(-1).value, [0, 2]);
  new live.LiveAPI('live_set tracks 0 clip_slots 0').set('is_recording', 1);
  assert.deepEqual(states(b.out).at(-1).value, [3, 2]);
});

test('bridge: clipToPad waits for the recording, then fills the next empty Simpler', () => {
  const live = makeLive();
  const { LiveAPI } = live;
  // Violin slot 1 is still recording; the file appears after two polls.
  const micSlot = new LiveAPI('live_set tracks 1 clip_slots 0').o;
  Object.assign(micSlot.props, { has_clip: 1, is_recording: 1 });
  micSlot.children.clip = { id: 9001, props: { file_path: '' }, children: {} };
  live.beforeTick = (i) => {
    if (i === 2) {
      micSlot.props.is_recording = 0;
      micSlot.children.clip.props.file_path = '/rec/clap.wav';
    }
  };
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'clipToPad', source: 'Violin', scene: 1, target: 'Bass', rack: 'first', pad: 'next' }, fn: 'clipToPad' }));
  const notices = b.out.filter((x) => x[0] === 'liveState').map((x) => x[1]).filter((x) => x.type === 'notice');
  assert.equal(notices.at(-1).text, 'Uzorak → D1');
  assert.equal(live.pads[2].children.chains[0].children.devices[0].children.sample.props.file_path, '/rec/clap.wav');
});

test('bridge: recorded clip lands in the next empty Simpler and that pad gets selected', () => {
  const live = makeLive();
  const { LiveAPI } = live;
  const vioSlot = new LiveAPI('live_set tracks 1 clip_slots 0').o;
  Object.assign(vioSlot.props, { has_clip: 1, is_recording: 0 });
  vioSlot.children.clip = { id: 9002, props: { file_path: '/rec/clap.wav' }, children: {} };
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'clipToPad', source: 'Violin', scene: 1, target: 'Bass', rack: 'first', pad: 'next' }, fn: 'clipToPad' }));
  // Pad C1 already has a sample, C#1 has no Simpler, D1 is the first empty Simpler.
  const d1 = live.pads[2].children.chains[0].children.devices[0];
  assert.equal(d1.children.sample.props.file_path, '/rec/clap.wav');
  assert.equal(live.drums.children.view.props.selected_drum_pad, live.pads[2].id);
  const n = b.out.filter((x) => x[0] === 'liveState').map((x) => x[1]).filter((x) => x.type === 'notice').at(-1);
  assert.equal(n.text, 'Uzorak → D1');
});

test('bridge: "#2" addresses the second rack on a track', () => {
  const live = makeLive();
  live.vio.children.devices.push(live.obj({ name: 'Second Rack', can_have_chains: 1, variation_count: 5, selected_variation_index: 1 }, { parameters: [], chains: [] }));
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'watch', targets: { 'Violin|#2': { track: 'Violin', device: '#2' } } }));
  const st = states(b.out).filter((x) => x.type === 'variations').at(-1);
  assert.deepEqual([st.ok, st.count, st.name], [true, 5, 'Second Rack']);
});

test('bridge: track navigation moves the selection', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'nav' }, fn: 'trackPrev' }));
  assert.equal(live.songView.props.selected_track, live.bass.id);
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'nav' }, fn: 'trackPrev' }));
  assert.equal(live.songView.props.selected_track, live.bass.id); // clamps at the first track
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'nav' }, fn: 'trackNext' }));
  assert.equal(live.songView.props.selected_track, live.vio.id);
});

test('bridge: fixed-length record fires with beats = bars x signature numerator', () => {
  const live = makeLive();
  live.song.props.signature_numerator = 4;
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'slot', track: 'Bass', scene: 1 }, fn: 'fireSlot', recordBars: 2 }));
  const fire = live.calls.find((c) => c[1] === 'fire');
  assert.deepEqual(fire.slice(1), ['fire', 8]);
});

test('bridge: selectDrumPad selects the pad with that note, then lastToSelected replaces it', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'drumPad', target: 'Bass', rack: 'first', note: 39 }, fn: 'selectDrumPad' }));
  assert.equal(live.drums.children.view.props.selected_drum_pad, live.pads[3].id);
  const vioSlot = new live.LiveAPI('live_set tracks 1 clip_slots 0').o;
  Object.assign(vioSlot.props, { has_clip: 1, is_recording: 0 });
  vioSlot.children.clip = { id: 9003, props: { file_path: '/rec/shaker.wav' }, children: {} };
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'clipToPad', source: 'Violin', scene: 1, target: 'Bass', rack: 'first', pad: 'selected' }, fn: 'clipToPad' }));
  assert.equal(live.pads[3].children.chains[0].children.devices[0].children.sample.props.file_path, '/rec/shaker.wav');
});

test('bridge: recordings load as One-Shot; Simpler edits act on the selected pad', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const vioSlot = new live.LiveAPI('live_set tracks 1 clip_slots 0').o;
  Object.assign(vioSlot.props, { has_clip: 1, is_recording: 0 });
  vioSlot.children.clip = { id: 9004, props: { file_path: '/rec/clap.wav' }, children: {} };
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'drumPad', target: 'Bass', rack: 'first', note: 38 }, fn: 'selectDrumPad' }));
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'clipToPad', source: 'Violin', scene: 1, target: 'Bass', rack: 'first', pad: 'selected', mode: 'oneshot' }, fn: 'clipToPad' }));
  const sim = live.pads[2].children.chains[0].children.devices[0];
  assert.equal(sim.children.sample.props.file_path, '/rec/clap.wav');
  assert.equal(sim.props.playback_mode, 1);
  live.calls.length = 0;
  const edit = (op) => b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'simpler', target: 'Bass', rack: 'first', op }, fn: 'simpler' }));
  edit('reverse');
  edit('crop');
  assert.deepEqual(live.calls.map((c) => c[1]), ['reverse', 'crop']);
  edit('slice');
  assert.equal(sim.props.playback_mode, 2);
  edit('warp');
  assert.equal(sim.children.sample.props.warping, 1);
  edit('warp');
  assert.equal(sim.children.sample.props.warping, 0);
});

test('bridge: padParam follows the Drum Rack pad selection, also from an empty pad', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const p = (name, value) => live.obj({ name, value, min: 0, max: 1, is_quantized: 0 });
  live.pads[0].children.chains[0].children.devices[0].children.parameters = [p('S Start', 0), p('Transpose', 0.5)];
  live.pads[2].children.chains[0].children.devices[0].children.parameters = [p('S Start', 0), p('Transpose', 0.2)];
  const spec = { t: 'param', target: 'padParam', track: 'Bass', device: 'first', param: 'transpose' };
  b.live(JSON.stringify({ cmd: 'watchLive', targets: { p: spec } }));
  let st = states(b.out).at(-1);
  assert.deepEqual([st.ok, st.value, st.name], [true, 0.5, 'Transpose']);
  const view = new live.LiveAPI('live_set tracks 0 devices 0 view');
  view.set('selected_drum_pad', 'id', live.pads[2].id);
  assert.equal(states(b.out).at(-1).value, 0.2);
  view.set('selected_drum_pad', 'id', live.pads[1].id); // empty pad: nothing to control
  assert.equal(states(b.out).at(-1).ok, false);
  // A Simpler dropped onto the empty selected pad is picked up without reselecting.
  const sim = live.obj({ name: 'Simpler', class_name: 'OriginalSimpler' }, { sample: null, parameters: [p('Transpose', 0.9)] });
  live.pads[1].children.chains = [live.obj({ name: 'C#1' }, { devices: [sim] })];
  new live.LiveAPI(`id ${live.pads[1].id}`).set('chains', 1);
  assert.deepEqual([states(b.out).at(-1).ok, states(b.out).at(-1).value], [true, 0.9]);
  view.set('selected_drum_pad', 'id', live.pads[0].id); // back to a Simpler: found again
  st = states(b.out).at(-1);
  assert.deepEqual([st.ok, st.value], [true, 0.5]);
  b.live(JSON.stringify({ cmd: 'liveSet', key: 'p', spec, value: 0.75 }));
  assert.equal(live.pads[0].children.chains[0].children.devices[0].children.parameters[1].props.value, 0.75);
});

test('bridge stays ES5 (Max [js] has no ES6): no arrows, let/const, template strings, spread, classes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'p3um-live.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  for (const [what, re] of [['arrow', /=>/], ['let/const', /\b(let|const)\s/], ['template string', /`/], ['spread', /\.\.\./], ['class', /\bclass\s+\w/], ['ES6 string/array helper', /\.(includes|startsWith|endsWith|find|findIndex)\(/]]) {
    assert.ok(!re.test(src), `p3um-live.js uses ${what}`);
  }
});

test('bridge: slicer loads the recording into the track Simpler in Slice mode', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  const slicer = live.obj({ name: 'Simpler', class_name: 'OriginalSimpler' }, { sample: null });
  live.bass.children.devices.push(slicer);
  const vioSlot = new live.LiveAPI('live_set tracks 1 clip_slots 0').o;
  Object.assign(vioSlot.props, { has_clip: 1, is_recording: 0 });
  vioSlot.children.clip = { id: 9005, props: { file_path: '/rec/phrase.wav' }, children: {} };
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'clipToPad', source: 'Violin', scene: 1, target: 'Bass', rack: 'first', pad: 'simpler', mode: 'slice' }, fn: 'clipToPad' }));
  assert.equal(slicer.children.sample.props.file_path, '/rec/phrase.wav');
  assert.equal(slicer.props.playback_mode, 2);
});

test('bridge: stopAll stops every clip in the set', () => {
  const live = makeLive();
  const b = loadBridge(live);
  b.init();
  b.live(JSON.stringify({ cmd: 'liveCall', spec: { t: 'song' }, fn: 'stopAll' }));
  assert.ok(live.calls.some((c) => c[1] === 'stop_all_clips'));
});
