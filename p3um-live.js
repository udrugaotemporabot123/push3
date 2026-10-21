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
