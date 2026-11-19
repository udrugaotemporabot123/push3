// Push 3 screen from a Max for Live device (Push3Ekran.amxd), Max [js], ES5.
//
// Draws "where am I" (selected track, rack row, variations of the rack in use) with jit.lcd and hands
// each frame to [live.push] through its undocumented "jit_matrix" message (found and verified on a
// tethered Push 3 by github.com/Cardamien/push3-max-lab, MIT). Data comes from the Lite device's Node
// engine over [r p3um_screen]; this script never asks Live for anything.
//
//   in:  "start"               (live.thisdevice: device loaded)
//        "screen <json>"       summary from the Lite device
//        "enable 0|1"          Ekran toggle
//        "test 0|1"            draw a test picture with a counter, in any mode
//   out 0: drawing commands + "bang" for [jit.lcd 4 char 960 160]
//   out 1: "clear", "bang" for an all-zero [jit.matrix] (transparent frame: hands the screen back)
//   out 2: "bang" to [s p3um_screen_req] (ask the Lite device for the current summary)

autowatch = 0;
inlets = 1;
outlets = 3;

var W = 960;
var H = 160;
var state = null; // last summary from the Lite device
var enabled = 1;
var testMode = 0;
var dirty = true;
var shown = false;
var ticks = 0;
var task = new Task(tick);
task.interval = 200; // 5 frames a second at most; the Push holds a picture only while frames keep coming

function start() {
  task.cancel();
  task.repeat();
  outlet(2, 'bang');
}

function screen(json) {
  try {
    state = JSON.parse(json);
  } catch (e) {
    return;
  }
  dirty = true;
}

function enable(v) {
  enabled = v ? 1 : 0;
  dirty = true;
  if (!enabled) hide();
}

function test(v) {
  testMode = v ? 1 : 0;
  dirty = true;
}

function hide() {
  if (!shown) return;
  shown = false;
  outlet(1, 'clear');
  outlet(1, 'bang');
}

function tick() {
  ticks++;
  var show = enabled && (testMode || (state && state.mode === 'user'));
  if (!show) return hide();
  if (testMode) {
    drawTest();
    return;
  }
  if (dirty) {
    dirty = false;
    draw();
  } else if (ticks % 5 === 0) {
    outlet(0, 'bang'); // keep the same picture alive (about once a second)
  }
}

function lcd() {
  outlet(0, Array.prototype.slice.call(arguments));
}

function color(rgb) {
  rgb = rgb || [128, 128, 128];
  lcd('frgb', rgb[0] | 0, rgb[1] | 0, rgb[2] | 0);
}

function dim(rgb) {
  rgb = rgb || [128, 128, 128];
  return [(rgb[0] * 0.35) | 0, (rgb[1] * 0.35) | 0, (rgb[2] * 0.35) | 0];
}

function text(x, y, size, s) {
  lcd('font', 'Arial', size);
  lcd('moveto', x, y);
  lcd('write', String(s));
}

function begin() {
  lcd('brgb', 0, 0, 0);
  lcd('clear');
  shown = true;
}

function draw() {
  var d = state || {};
  begin();
  // Top line: track (with its colour), rack in use, variation.
  var tr = d.track;
  color(tr ? tr.rgb : [90, 90, 90]);
  lcd('paintrect', 0, 2, 10, 40);
  lcd('frgb', 255, 255, 255);
  text(18, 32, 28, tr ? tr.name : 'Klikni Rackovi');
  if (d.rack) {
    color(d.rack.rgb);
    text(420, 32, 28, d.rack.name);
  }
  var vars = d.vars || { count: 0, selected: -1 };
  lcd('frgb', 255, 255, 255);
  text(800, 32, 28, vars.selected >= 0 ? 'VAR ' + (vars.selected + 1) + '/' + vars.count : '');
  // Rack row: 8 cells of 120 px (like the encoders).
  var racks = d.racks || [];
  for (var i = 0; i < 8; i++) {
    var r = racks[i];
    if (!r) continue;
    var x = i * 120;
    if (r.inUse) {
      lcd('frgb', 255, 255, 255);
      lcd('paintrect', x + 4, 48, x + 116, 90);
      lcd('frgb', 0, 0, 0);
    } else if (r.present) {
      color(r.rgb);
      lcd('paintrect', x + 4, 48, x + 116, 90);
      lcd('frgb', 0, 0, 0);
    } else {
      color(dim(r.rgb));
      lcd('framerect', x + 4, 48, x + 116, 90);
    }
    text(x + 10, 76, 18, r.label);
  }
  // Variations 1-24: like the three pad rows (white = active, rack colour = exists).
  var rackRgb = d.rack ? d.rack.rgb : [0, 80, 255];
  for (var v = 0; v < 24; v++) {
    var vx = v * 40;
    if (v === vars.selected) lcd('frgb', 255, 255, 255);
    else if (v < vars.count) color(rackRgb);
    else {
      lcd('frgb', 50, 50, 50);
      lcd('framerect', vx + 3, 100, vx + 37, 150);
      continue;
    }
    lcd('paintrect', vx + 3, 100, vx + 37, 150);
    lcd('frgb', 0, 0, 0);
    text(vx + (v < 9 ? 14 : 9), 132, 16, v + 1);
  }
  lcd('bang');
}

function drawTest() {
  begin();
  lcd('frgb', 255, 255, 255);
  lcd('framerect', 0, 0, W, H);
  text(20, 50, 36, 'PUSH 3 EKRAN TEST');
  text(20, 100, 24, 'okvir ' + ticks + (state ? '   mode: ' + state.mode : '   (nema podataka od Lite devicea)'));
  lcd('frgb', 255, 0, 0);
  lcd('paintrect', 700, 20, 760, 80);
  lcd('frgb', 0, 255, 0);
  lcd('paintrect', 780, 20, 840, 80);
  lcd('frgb', 0, 0, 255);
  lcd('paintrect', 860, 20, 920, 80);
  var bar = (ticks * 16) % W;
  lcd('frgb', 255, 200, 0);
  lcd('paintrect', bar, 120, bar + 12, 150);
  lcd('bang');
}

// The device is deleted or the set closes: give the screen back, or the last picture would stay.
function notifydeleted() {
  task.cancel();
  shown = true;
  hide();
}
