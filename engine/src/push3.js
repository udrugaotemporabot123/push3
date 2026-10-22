'use strict';
// Push 3 hardware description: every control, the MIDI it sends on the User Port,
// how its LED is addressed, and where it sits in the editor (schematic layout, 1200x780).
//
// Sources: Ableton "Push 2 MIDI and Display Interface Manual" (Push 3 keeps the protocol),
// the Push 3 manual (User Mode chapter), and the open-source DrivenByMoss Push 3 driver.
// Numbers marked `verify: true` are not confirmed on hardware yet; the editor's MIDI monitor
// and "discovered controls" list exist to confirm or correct them on a real Push 3.

const SYSEX_HEADER = [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01];

const SYSEX = {
  SET_MIDI_MODE: 0x0a, // reply goes to both ports: [mode] 0=Live 1=User 2=Dual
  SET_AFTERTOUCH_MODE: 0x1e, // 0=channel pressure, 1=poly pressure, 2=MPE (Push 3)
  GET_AFTERTOUCH_MODE: 0x1f,
  SET_TOUCHSTRIP_CONFIG: 0x17,
  GET_TOUCHSTRIP_CONFIG: 0x18,
};

const AFTERTOUCH = { CHANNEL: 0, POLY: 1, MPE: 2 };

// LED animation is selected by the MIDI channel of the LED message (Push 2 manual, "LED Animation").
const ANIMATIONS = {
  none: 0,
  'pulse-slow': 10, // pulsing, half note
  pulse: 9, // pulsing, quarter
  'pulse-fast': 8, // pulsing, 8th
  'blink-slow': 15, // blinking, half
  blink: 14, // blinking, quarter
  'blink-fast': 13, // blinking, 8th
};

// Kinds: 'pad' (note in, RGB), 'button' (CC in, LED by CC), 'encoder' (relative CC in),
// 'touchstrip' (pitch bend / CC1 in).
const controls = [];

function add(def) {
  controls.push(def);
}

// ---- Pads: notes 36..99, row 0 is the bottom row --------------------------------------
const PAD = { x0: 230, y0: 300, size: 54, gap: 6 };
for (let row = 0; row < 8; row++) {
  for (let col = 0; col < 8; col++) {
    const note = 36 + row * 8 + col;
    add({
      id: `pad.${row}.${col}`,
      label: `Pad ${8 - row}/${col + 1}`,
      kind: 'pad',
      note,
      led: 'rgb',
      row,
      col,
      x: PAD.x0 + col * (PAD.size + PAD.gap),
      y: PAD.y0 + (7 - row) * (PAD.size + PAD.gap),
      w: PAD.size,
      h: PAD.size,
    });
  }
}

// ---- Encoders -------------------------------------------------------------------------
for (let i = 0; i < 8; i++) {
  add({
    id: `enc.${i + 1}`,
    label: `Encoder ${i + 1}`,
    short: `E${i + 1}`,
    kind: 'encoder',
    cc: 71 + i,
    touchNote: i,
    x: 236 + i * 60,
    y: 22,
    w: 42,
    h: 42,
  });
}
// Layout follows the Push 3 photo/template: Volume top-left, Swing/Tempo lower left, jog right of the display.
add({ id: 'enc.volume', label: 'Volume', short: 'Vol', kind: 'encoder', cc: 79, touchNote: 8, verify: true, x: 30, y: 64, w: 62, h: 62 });
add({ id: 'enc.tempo', label: 'Swing/Tempo', short: 'Tempo', kind: 'encoder', cc: 14, touchNote: 10, x: 34, y: 304, w: 50, h: 50 });
add({ id: 'jog', label: 'Jog wheel', short: 'Jog', kind: 'encoder', cc: 70, touchNote: 11, x: 846, y: 140, w: 96, h: 96 });

// ---- Touch strip ---------------------------------------------------------------------
add({ id: 'strip', label: 'Touch strip', short: 'Strip', kind: 'touchstrip', touchNote: 12, x: 186, y: 300, w: 26, h: 474 });

// ---- Buttons ---------------------------------------------------------------------------
function button(id, label, cc, x, y, opts = {}) {
  add({ id, label, kind: 'button', cc, led: 'white', x, y, w: 64, h: 26, ...opts });
}

// Display buttons (upper row 102..109, lower row 20..27) and scene buttons 36..43 are RGB.
for (let i = 0; i < 8; i++) {
  button(`upper.${i + 1}`, `Upper ${i + 1}`, 102 + i, 230 + i * 60, 86, { short: `U${i + 1}`, led: 'rgb', w: 54, h: 20 });
  button(`lower.${i + 1}`, `Lower ${i + 1}`, 20 + i, 230 + i * 60, 268, { short: `L${i + 1}`, led: 'rgb', w: 54, h: 20 });
  // Scene 1 (CC 36, "1/4") is the top button.
  button(`scene.${i + 1}`, `Scene ${i + 1}`, 36 + i, 716, PAD.y0 + i * (PAD.size + PAD.gap) + 12, { short: `S${i + 1}`, led: 'rgb', w: 44, h: 30 });
}

// Top-left row: Sets, Setup, Learn, User.
button('sets', 'Sets', 80, 14, 22, { w: 40, verify: true });
button('setup', 'Setup', 30, 58, 22, { w: 40 });
button('learn', 'Learn', 81, 102, 22, { w: 40, verify: true });
// The User button toggles User Mode in Live and must never be remapped or lit by us.
add({ id: 'user', label: 'User', kind: 'button', cc: 59, led: 'none', reserved: true, x: 146, y: 22, w: 40, h: 26 });
button('volume.press', 'Volume press', 111, 104, 74, { short: 'Vol push', w: 66, h: 20, verify: true });
button('undo', 'Undo', 119, 104, 100, { w: 66, h: 22, verify: true });
button('delete', 'Delete', 118, 104, 126, { w: 66, h: 22 });

// Lock / Stop Clip / Mute / Solo row (level with the lower display buttons).
button('lock', 'Lock', 83, 14, 266, { w: 40 });
button('stop', 'Stop Clip', 29, 58, 266, { short: 'Stop', w: 40, led: 'rgb' });
button('mute', 'Mute', 60, 102, 266, { w: 40, led: 'rgb' });
button('solo', 'Solo', 61, 146, 266, { w: 40, led: 'rgb' });
button('tempo.press', 'Tempo press', 15, 92, 318, { short: 'Tempo push', w: 76, h: 22 });

// Left column under the tempo encoder.
const L = 14;
button('tap', 'Tap Tempo', 3, L, 370, { short: 'Tap', w: 76 });
button('metronome', 'Metronome', 9, L + 82, 370, { short: 'Metro', w: 76 });
button('save', 'Save', 82, L, 404, { w: 76, verify: true });
button('convert', 'Convert', 35, L + 82, 404, { w: 76 });
button('double', 'Double Loop', 117, L, 438, { short: 'Double', w: 76 });
button('quantize', 'Quantize', 116, L + 82, 438, { w: 76 });
button('duplicate', 'Duplicate', 88, L, 472, { w: 76 });
button('fixed', 'Fixed Length', 90, L + 82, 472, { short: 'Fixed Len', w: 76 });
button('automate', 'Automate', 89, L, 506, { w: 76, led: 'rgb' });
button('new', 'New', 92, L, 580, { w: 76 });
button('capture', 'Capture', 65, L, 614, { w: 76 });
button('record', 'Record', 86, L, 660, { w: 76, h: 40, led: 'rgb' });
button('play', 'Play', 85, L, 720, { w: 76, h: 40, led: 'rgb' });

// Right of the display.
button('master', 'Main', 28, 716, 268, { w: 44, h: 20 });
button('swap', 'Swap', 33, 770, 22, { verify: true });
button('add', 'Add', 32, 840, 22, { verify: true });
button('device', 'Device', 110, 910, 22);
button('mix', 'Mix', 112, 980, 22);
button('clip', 'Clip', 113, 1050, 22);
button('sessionScreen', 'Session Screen', 34, 1120, 22, { short: 'Sess.Scr', verify: true });

// Jog wheel nudges and press.
button('jog.left', 'Jog nudge left', 93, 770, 176, { short: 'Jog ◀', w: 66, verify: true });
button('jog.right', 'Jog nudge right', 95, 952, 176, { short: 'Jog ▶', w: 66, verify: true });
button('jog.press', 'Jog press', 94, 860, 244, { short: 'Jog push', w: 66 });

// Right block.
const R = 800;
button('note', 'Note', 50, R, 300);
button('session', 'Session', 51, R + 72, 300);
button('scale', 'Scale', 58, R, 334);
button('layout', 'Layout', 31, R + 72, 334);
button('repeat', 'Repeat', 56, R, 368);
button('accent', 'Accent', 57, R + 72, 368);
button('octDown', 'Octave Down', 54, R, 420, { short: 'Oct −' });
button('octUp', 'Octave Up', 55, R + 72, 420, { short: 'Oct +' });
button('pageLeft', 'Page Left', 62, R, 454, { short: 'Page ◀' });
button('pageRight', 'Page Right', 63, R + 72, 454, { short: 'Page ▶' });
button('shift', 'Shift', 49, R, 506);
button('select', 'Select', 48, R + 72, 506);

// D-pad.
button('up', 'Up', 46, 1010, 360, { short: '▲', w: 50 });
button('left', 'Left', 44, 952, 394, { short: '◀', w: 50 });
button('center', 'Center', 91, 1010, 394, { short: '●', w: 50 });
button('right', 'Right', 45, 1068, 394, { short: '▶', w: 50 });
button('down', 'Down', 47, 1010, 428, { short: '▼', w: 50 });

// Touch surfaces that only send a note (no LED): D-pad area and touch strip.
add({ id: 'dpad.touch', label: 'D-pad touch', short: 'D-pad touch', kind: 'touch', note: 13, led: 'none', x: 952, y: 462, w: 166, h: 18 });
add({ id: 'strip.touch', label: 'Touch strip touch', short: 'Strip touch', kind: 'touch', note: 12, led: 'none', x: 150, y: 778, w: 70, h: 16 });

// Pedals (no LED).
button('foot1', 'Footswitch 1', 64, 960, 732, { short: 'Pedal 1', led: 'none' });
button('foot2', 'Footswitch 2', 69, 1040, 732, { short: 'Pedal 2', led: 'none' });

const byId = new Map(controls.map((c) => [c.id, c]));

// Input lookup tables.
const padByNote = new Map();
const buttonByCc = new Map();
const encoderByCc = new Map();
const encoderByTouchNote = new Map();
const touchByNote = new Map();
for (const c of controls) {
  if (c.kind === 'pad') padByNote.set(c.note, c);
  else if (c.kind === 'touch') touchByNote.set(c.note, c);
  else if (c.kind === 'button') buttonByCc.set(c.cc, c);
  else if (c.kind === 'encoder') {
    encoderByCc.set(c.cc, c);
    encoderByTouchNote.set(c.touchNote, c);
  }
}
const strip = byId.get('strip');
encoderByTouchNote.delete(strip.touchNote);

module.exports = {
  SYSEX_HEADER,
  SYSEX,
  AFTERTOUCH,
  ANIMATIONS,
  controls,
  byId,
  padByNote,
  buttonByCc,
  encoderByCc,
  encoderByTouchNote,
  touchByNote,
  STRIP_TOUCH_NOTE: strip.touchNote,
  USER_BUTTON_CC: 59,
};
