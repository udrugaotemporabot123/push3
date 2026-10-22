// Push 3 User Mode – Live API bridge (Max [js], ES5).
// Receives commands from the Node engine and reports rack variation state back.
//
//   in:  "init"                      (from live.thisdevice, Live API is ready)
//        "live <json>"               {cmd:'watch', targets:{key:{track,device}}}
//                                    {cmd:'variation', key, target, action, index}
//   out: "liveState <json>"          {type:'variations', key, ok, count, selected, name}
//        "bridgeReady"

autowatch = 1;
inlets = 1;
outlets = 1;

var ready = false;
var targets = {}; // key -> { target, rackId, watchers: [] }
var pendingWatch = null;
var selectedTrackWatcher = null;
var pendingLive = null;
var liveTargets = {}; // key -> { spec, watchers: [], path }

function init() {
  ready = true;
  // Re-resolve every "selected" target when the selected track changes.
  selectedTrackWatcher = new LiveAPI(onSelectedTrack, 'live_set view');
  selectedTrackWatcher.property = 'selected_track';
  outlet(0, 'bridgeReady');
  if (pendingWatch) {
    watch(pendingWatch);
    pendingWatch = null;
  }
  if (pendingLive) {
    watchLive(pendingLive);
    pendingLive = null;
  }
}

function live(json) {
  var msg;
  try {
    msg = JSON.parse(json);
  } catch (e) {
    post('p3um-live: bad json\n');
    return;
  }
  if (msg.cmd === 'watch') {
    if (!ready) pendingWatch = msg.targets;
    else watch(msg.targets);
  } else if (msg.cmd === 'variation') {
    if (ready) variation(msg);
  } else if (msg.cmd === 'watchLive') {
    if (!ready) pendingLive = msg.targets;
    else watchLive(msg.targets);
  } else if (msg.cmd === 'liveSet') {
    if (ready) liveSet(msg);
  } else if (msg.cmd === 'liveCall') {
    if (ready) liveCall(msg);
  }
}

// ---------------------------------------------------------------------------------------

function watch(newTargets) {
  var key;
  for (key in targets) {
    if (!newTargets[key]) {
      dropWatchers(targets[key]);
      delete targets[key];
    }
  }
  for (key in newTargets) {
    if (!targets[key]) targets[key] = { target: newTargets[key], rackId: 0, watchers: [] };
    resolve(key);
  }
}

function onSelectedTrack() {
  for (var key in targets) {
    if (targets[key].target.track === 'selected') resolve(key);
  }
  for (var lk in liveTargets) {
    var sp = liveTargets[lk].spec;
    if (sp.track === 'selected' || sp.t === 'trackSelect' || sp.target === 'deviceParam') resolveLive(lk);
  }
}

function dropWatchers(t) {
  for (var i = 0; i < t.watchers.length; i++) {
    t.watchers[i].property = '';
  }
  t.watchers = [];
}

function resolve(key) {
  var t = targets[key];
  if (!t) return;
  dropWatchers(t);
  var track = findTrack(t.target.track);
  var rack = track ? findRack(track, t.target.device) : null;
  t.rackId = rack ? rack.id : 0;
  if (!rack) {
    report(key, false, 0, -1, '');
    // Watch the track's device list so the rack is found as soon as it is added.
    if (track) {
      // Observers fire once immediately when set up; skip that one or resolve() would loop.
      var first = true;
      var dw = new LiveAPI(function () {
        if (first) {
          first = false;
          return;
        }
        if (targets[key] && !targets[key].rackId) resolve(key);
      }, 'id ' + track.id);
      dw.property = 'devices';
      t.watchers.push(dw);
    }
    return;
  }
  var onChange = function () {
    sendState(key);
  };
  var w1 = new LiveAPI(onChange, 'id ' + rack.id);
  w1.property = 'variation_count';
  var w2 = new LiveAPI(onChange, 'id ' + rack.id);
  w2.property = 'selected_variation_index';
  t.watchers.push(w1, w2);
  sendState(key);
}

function sendState(key) {
  var t = targets[key];
  if (!t || !t.rackId) return;
  var rack = new LiveAPI('id ' + t.rackId);
  if (!rack.id || rack.id == 0) {
    resolve(key);
    return;
  }
  report(key, true, num(rack.get('variation_count')), num(rack.get('selected_variation_index')), str(rack.get('name')));
}

function report(key, ok, count, selected, name) {
  outlet(0, 'liveState', JSON.stringify({ type: 'variations', key: key, ok: ok, count: count, selected: selected, name: name }));
}

// ---------------------------------------------------------------------------------------

function findTrack(spec) {
  if (!spec || spec === 'selected') {
    var sel = new LiveAPI('live_set view selected_track');
    return sel.id && sel.id != 0 ? sel : null;
  }
  var wanted = String(spec).toLowerCase();
  var lists = ['tracks', 'return_tracks'];
  for (var l = 0; l < lists.length; l++) {
    var set = new LiveAPI('live_set');
    var n = set.getcount(lists[l]);
    for (var i = 0; i < n; i++) {
      var tr = new LiveAPI('live_set ' + lists[l] + ' ' + i);
      if (str(tr.get('name')).toLowerCase() === wanted) return tr;
    }
  }
  var master = new LiveAPI('live_set master_track');
  if (str(master.get('name')).toLowerCase() === wanted || wanted === 'master' || wanted === 'main') return master;
  return null;
}

// First rack on the track (or the rack with that name), searching one level into chains.
function findRack(track, spec) {
  var wanted = spec && spec !== 'first' ? String(spec).toLowerCase() : null;
  return searchDevices(track.unquotedpath, wanted, 0);
}

function searchDevices(path, wanted, depth) {
  var parent = new LiveAPI(path);
  var n = parent.getcount('devices');
  var i, d;
  for (i = 0; i < n; i++) {
    d = new LiveAPI(path + ' devices ' + i);
    if (num(d.get('can_have_chains')) === 1) {
      if (!wanted || str(d.get('name')).toLowerCase() === wanted) return d;
    }
  }
  if (!wanted || depth > 0) return null;
  // Named rack may be nested inside another rack's chains.
  for (i = 0; i < n; i++) {
    d = new LiveAPI(path + ' devices ' + i);
    if (num(d.get('can_have_chains')) !== 1) continue;
    var chains = d.getcount('chains');
    for (var c = 0; c < chains; c++) {
      var found = searchDevices(path + ' devices ' + i + ' chains ' + c, wanted, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------

function variation(msg) {
  var t = targets[msg.key];
  if (!t) {
    targets[msg.key] = { target: msg.target, rackId: 0, watchers: [] };
    resolve(msg.key);
    t = targets[msg.key];
  }
  if (!t.rackId) return;
  var rack = new LiveAPI('id ' + t.rackId);
  var count = num(rack.get('variation_count'));
  var index = msg.index | 0;
  switch (msg.action) {
    case 'recall':
      if (index < count) {
        rack.set('selected_variation_index', index);
        rack.call('recall_selected_variation');
      }
      break;
    case 'store':
      // Live can only append a new variation; on an empty slot that is exactly this pad.
      if (index >= count) rack.call('store_variation');
      else post('p3um: variation ' + (index + 1) + ' already exists; delete it first to re-store\n');
      break;
    case 'delete':
      if (index < count) {
        rack.set('selected_variation_index', index);
        rack.call('delete_selected_variation');
      }
      break;
    case 'recallLast':
      rack.call('recall_last_used_variation');
      break;
    case 'randomize':
      rack.call('randomize_macros');
      break;
  }
  sendState(msg.key);
}

function num(v) {
  var x = Array.isArray(v) ? v[0] : v;
  x = Number(x);
  return isNaN(x) ? 0 : x;
}

function str(v) {
  if (Array.isArray(v)) v = v.join(' ');
  v = String(v === undefined ? '' : v);
  if (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') v = v.slice(1, -1);
  return v;
}

// ---------------------------------------------------------------------------------------
// Live-aware controls: observe/set track mute/solo/arm/select, transport, mixer and device
// parameters. Values are normalised to 0..1 for parameters, 0/1 for switches.

var TEMPO_MIN = 60;
var TEMPO_MAX = 200;

function watchLive(newTargets) {
  var key;
  for (key in liveTargets) {
    if (!newTargets[key]) {
      dropWatchers(liveTargets[key]);
      delete liveTargets[key];
    }
  }
  for (key in newTargets) {
    if (!liveTargets[key]) liveTargets[key] = { spec: newTargets[key], watchers: [], path: null };
    resolveLive(key);
  }
}

function trackApi(spec) {
  var t = spec === undefined || spec === null || spec === '' ? 'selected' : String(spec);
  if (/^[0-9]+$/.test(t)) {
    var n = parseInt(t, 10) - 1;
    var set = new LiveAPI('live_set');
    if (n < 0 || n >= set.getcount('tracks')) return null;
    return new LiveAPI('live_set tracks ' + n);
  }
  return findTrack(t);
}

// Path of the object a spec talks to, plus which property holds its value.
function livePath(spec) {
  var tr;
  if (spec.t === 'song') return { path: 'live_set', prop: spec.prop };
  if (spec.t === 'trackProp' || spec.t === 'trackSelect') {
    tr = trackApi(spec.track);
    if (!tr) return null;
    if (spec.t === 'trackProp') {
      if (spec.prop === 'arm' && num(tr.get('can_be_armed')) !== 1) return null;
      if (spec.prop !== 'arm' && tr.unquotedpath.indexOf('master_track') >= 0) return null;
    }
    return { path: tr.unquotedpath, prop: spec.t === 'trackProp' ? spec.prop : null, trackId: tr.id };
  }
  if (spec.t === 'trackSlots') {
    tr = trackApi(spec.track);
    if (!tr) return null;
    return { path: tr.unquotedpath, slots: true, trackId: tr.id, count: tr.getcount('clip_slots') };
  }
  if (spec.t === 'slot') {
    tr = trackApi(spec.track);
    if (!tr) return null;
    var si = sceneIndex(spec.scene);
    if (si < 0 || si >= tr.getcount('clip_slots')) return null;
    return { path: tr.unquotedpath + ' clip_slots ' + si, slot: true, trackId: tr.id };
  }
  if (spec.t === 'param') {
    if (spec.target === 'tempo') return { path: 'live_set', prop: 'tempo', tempo: true };
    tr = trackApi(spec.track);
    if (!tr) return null;
    var base = tr.unquotedpath;
    switch (spec.target) {
      case 'volume':
        return { path: base + ' mixer_device volume', prop: 'value', param: true, trackId: tr.id };
      case 'pan':
        return { path: base + ' mixer_device panning', prop: 'value', param: true, trackId: tr.id };
      case 'send':
        return { path: base + ' mixer_device sends ' + ((spec.index | 0) - 1), prop: 'value', param: true, trackId: tr.id };
      case 'macro':
        var rack = findRack(tr, spec.device);
        if (!rack) return null;
        return { path: rack.unquotedpath + ' parameters ' + (spec.index | 0), prop: 'value', param: true, trackId: tr.id };
      case 'deviceParam':
        return { path: base + ' view selected_device parameters ' + (spec.index | 0), prop: 'value', param: true, trackId: tr.id, viewPath: base + ' view' };
      case 'named':
        var dev = findDevice(tr, spec.device);
        if (!dev) return null;
        var pp = findParam(dev, spec.param);
        if (!pp) return null;
        return { path: pp, prop: 'value', param: true, trackId: tr.id, viewPath: spec.device === 'selected' ? base + ' view' : null };
    }
  }
  return null;
}

function resolveLive(key) {
  var lt = liveTargets[key];
  if (!lt) return;
  dropWatchers(lt);
  var info = livePath(lt.spec);
  if (info) {
    var probe = new LiveAPI(info.path);
    if (!probe.id || probe.id == 0) info = null;
  }
  lt.info = info;
  if (!info) {
    reportLive(key, { ok: false });
    return;
  }
  var cb = function () {
    sendLive(key);
  };
  if (info.slots) {
    // Every slot of the track; re-resolve when scenes are added or removed.
    var sprops = ['has_clip', 'playing_status', 'is_recording'];
    for (var si2 = 0; si2 < info.count; si2++) {
      for (var sp2 = 0; sp2 < sprops.length; sp2++) {
        var wss = new LiveAPI(cb, info.path + ' clip_slots ' + si2);
        wss.property = sprops[sp2];
        lt.watchers.push(wss);
      }
    }
    var firstCount = true;
    var wcount = new LiveAPI(function () {
      if (firstCount) {
        firstCount = false;
        return;
      }
      resolveLive(key);
    }, info.path);
    wcount.property = 'clip_slots';
    lt.watchers.push(wcount);
  } else if (info.slot) {
    var props = ['has_clip', 'playing_status', 'is_recording', 'is_triggered', 'color'];
    for (var pi = 0; pi < props.length; pi++) {
      var ws = new LiveAPI(cb, info.path);
      ws.property = props[pi];
      lt.watchers.push(ws);
    }
  } else if (lt.spec.t === 'trackSelect') {
    // Selection changes are already observed globally (onSelectedTrack); colour changes here.
    var wc = new LiveAPI(cb, info.path);
    wc.property = 'color';
    lt.watchers.push(wc);
  } else {
    var w = new LiveAPI(cb, info.path);
    w.property = info.prop;
    lt.watchers.push(w);
    if (info.trackId && !info.param) {
      var wcol = new LiveAPI(cb, 'id ' + info.trackId);
      wcol.property = 'color';
      lt.watchers.push(wcol);
    }
  }
  if (info.viewPath) {
    // Re-resolve when another device gets selected on that track.
    var first = true;
    var wd = new LiveAPI(function () {
      if (first) {
        first = false;
        return;
      }
      resolveLive(key);
    }, info.viewPath);
    wd.property = 'selected_device';
    lt.watchers.push(wd);
  }
  sendLive(key);
}

function trackColor(trackId) {
  if (!trackId) return null;
  var c = num(new LiveAPI('id ' + trackId).get('color'));
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function sendLive(key) {
  var lt = liveTargets[key];
  if (!lt || !lt.info) return;
  var info = lt.info;
  var api = new LiveAPI(info.path);
  if (!api.id || api.id == 0) {
    resolveLive(key);
    return;
  }
  var spec = lt.spec;
  if (info.slots) {
    var states = [];
    for (var k = 0; k < info.count; k++) states.push(slotState(new LiveAPI(info.path + ' clip_slots ' + k)));
    reportLive(key, { ok: true, value: states, name: str(api.get('name')) });
    return;
  }
  if (info.slot) {
    var state = 0;
    if (num(api.get('is_recording')) === 1) state = 3;
    else if (num(api.get('is_triggered')) === 1) state = 4;
    else if (num(api.get('has_clip')) === 1) state = num(api.get('playing_status')) === 1 ? 2 : 1;
    var col = num(api.get('color'));
    reportLive(key, { ok: true, value: state, name: '', color: state ? [(col >> 16) & 255, (col >> 8) & 255, col & 255] : null });
    return;
  }
  if (spec.t === 'trackSelect') {
    var sel = new LiveAPI('live_set view selected_track');
    reportLive(key, { ok: true, value: sel.id == info.trackId ? 1 : 0, name: str(api.get('name')), color: trackColor(info.trackId) });
  } else if (info.tempo) {
    var bpm = num(api.get('tempo'));
    reportLive(key, { ok: true, value: (bpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN), name: 'Tempo', display: bpm.toFixed(1) + ' BPM' });
  } else if (info.param) {
    var v = num(api.get('value'));
    var min = num(api.get('min'));
    var max = num(api.get('max'));
    var disp = '';
    try {
      disp = str(api.call('str_for_value', v));
    } catch (e) {
      disp = String(Math.round(v * 100) / 100);
    }
    reportLive(key, { ok: true, value: max > min ? (v - min) / (max - min) : 0, name: str(api.get('name')), display: disp });
  } else {
    var val = num(api.get(info.prop));
    var name = spec.t === 'song' ? info.prop : str(api.get('name'));
    reportLive(key, { ok: true, value: val ? 1 : 0, name: name, color: info.trackId ? trackColor(info.trackId) : null });
  }
}

function reportLive(key, data) {
  data.type = 'live';
  data.key = key;
  outlet(0, 'liveState', JSON.stringify(data));
}

function liveSet(msg) {
  var key = msg.key;
  if (!liveTargets[key]) {
    liveTargets[key] = { spec: msg.spec, watchers: [], path: null };
    resolveLive(key);
  }
  var info = liveTargets[key].info;
  if (!info) return;
  var api = new LiveAPI(info.path);
  var value = Number(msg.value) || 0;
  if (msg.spec.t === 'song' && info.prop === 'is_playing') {
    api.call(value ? 'start_playing' : 'stop_playing');
  } else if (info.tempo) {
    api.set('tempo', TEMPO_MIN + Math.max(0, Math.min(1, value)) * (TEMPO_MAX - TEMPO_MIN));
  } else if (info.param) {
    var min = num(api.get('min'));
    var max = num(api.get('max'));
    var v = min + Math.max(0, Math.min(1, value)) * (max - min);
    if (num(api.get('is_quantized')) === 1) v = Math.round(v);
    api.set('value', v);
  } else {
    api.set(info.prop, value ? 1 : 0);
  }
}

var SONG_CALLS = { play: 'start_playing', stop: 'stop_playing', tap: 'tap_tempo', undo: 'undo', redo: 'redo', capture: 'capture_midi' };

// Scene number (1-based) or 0 = the selected scene -> 0-based index.
function sceneIndex(scene) {
  var n = scene | 0;
  if (n > 0) return n - 1;
  var sel = new LiveAPI('live_set view selected_scene');
  var set = new LiveAPI('live_set');
  var count = set.getcount('scenes');
  for (var i = 0; i < count; i++) {
    if (new LiveAPI('live_set scenes ' + i).id == sel.id) return i;
  }
  return -1;
}

function liveCall(msg) {
  var spec = msg.spec || {};
  if (msg.fn === 'fireSlot' || msg.fn === 'deleteSlot') {
    var info = livePath(spec);
    if (!info) return;
    var slot = new LiveAPI(info.path);
    if (msg.fn === 'fireSlot') slot.call('fire');
    else if (num(slot.get('has_clip')) === 1) slot.call('delete_clip');
    return;
  }
  if (msg.fn === 'stopTrack') {
    var st = trackApi(spec.track);
    if (st) st.call('stop_all_clips');
    return;
  }
  if (msg.fn === 'select') {
    var tr = trackApi(spec.track);
    if (tr) new LiveAPI('live_set view').set('selected_track', 'id', tr.id);
  } else if (msg.fn === 'fire') {
    var idx = spec.index | 0;
    var scene = idx > 0 ? new LiveAPI('live_set scenes ' + (idx - 1)) : new LiveAPI('live_set view selected_scene');
    if (scene.id && scene.id != 0) scene.call('fire');
  } else if (SONG_CALLS[msg.fn]) {
    new LiveAPI('live_set').call(SONG_CALLS[msg.fn]);
  }
}

// Device on a track by name (searching inside rack chains), 'first' or 'selected'.
function findDevice(track, spec) {
  var name = spec ? String(spec) : 'selected';
  if (name === 'selected') {
    var sel = new LiveAPI(track.unquotedpath + ' view selected_device');
    return sel.id && sel.id != 0 ? sel : null;
  }
  if (name === 'first') {
    if (track.getcount('devices') < 1) return null;
    return new LiveAPI(track.unquotedpath + ' devices 0');
  }
  return searchByName(track.unquotedpath, name.toLowerCase(), 0);
}

function searchByName(path, wanted, depth) {
  var parent = new LiveAPI(path);
  var n = parent.getcount('devices');
  var i;
  for (i = 0; i < n; i++) {
    var d = new LiveAPI(path + ' devices ' + i);
    if (str(d.get('name')).toLowerCase() === wanted) return d;
  }
  if (depth > 1) return null;
  for (i = 0; i < n; i++) {
    var r = new LiveAPI(path + ' devices ' + i);
    if (num(r.get('can_have_chains')) !== 1) continue;
    var chains = r.getcount('chains');
    for (var c = 0; c < chains; c++) {
      var found = searchByName(path + ' devices ' + i + ' chains ' + c, wanted, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// Parameter path by number (1 = first after "Device On", 0 = "Device On") or by name.
function findParam(device, spec) {
  var s = String(spec === undefined ? '1' : spec);
  var n = device.getcount('parameters');
  if (/^[0-9]+$/.test(s)) {
    var idx = parseInt(s, 10);
    return idx < n ? device.unquotedpath + ' parameters ' + idx : null;
  }
  var wanted = s.toLowerCase();
  for (var i = 0; i < n; i++) {
    var p = new LiveAPI(device.unquotedpath + ' parameters ' + i);
    if (str(p.get('name')).toLowerCase() === wanted) return device.unquotedpath + ' parameters ' + i;
  }
  return null;
}

function slotState(slot) {
  if (num(slot.get('is_recording')) === 1) return 3;
  if (num(slot.get('has_clip')) !== 1) return 0;
  return num(slot.get('playing_status')) === 1 ? 2 : 1;
}
