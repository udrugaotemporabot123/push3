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
    kind: 'encoder',
    cc: 71 + i,
    touchNote: i,
    x: 236 + i * 60,
    y: 22,
    w: 42,
    h: 42,
  });
}
add({ id: 'enc.volume', label: 'Volume', kind: 'encoder', cc: 79, touchNote: 8, pressCc: 111, verify: true, x: 1110, y: 22, w: 46, h: 46 });
add({ id: 'enc.tempo', label: 'Swing/Tempo', kind: 'encoder', cc: 14, touchNote: 10, pressCc: 15, verify: true, x: 40, y: 22, w: 54, h: 54 });
add({ id: 'jog', label: 'Jog wheel', kind: 'encoder', cc: 70, touchNote: 9, pressCc: 94, verify: true, x: 1040, y: 330, w: 80, h: 80 });

// ---- Touch strip ---------------------------------------------------------------------
add({ id: 'strip', label: 'Touch strip', kind: 'touchstrip', touchNote: 12, x: 186, y: 300, w: 24, h: 474 });

// ---- Buttons ---------------------------------------------------------------------------
function button(id, label, cc, x, y, opts = {}) {
  add({ id, label, kind: 'button', cc, led: 'white', x, y, w: 64, h: 26, ...opts });
}

// Display buttons (upper row 102..109, lower row 20..27) and scene buttons 36..43 are RGB.
for (let i = 0; i < 8; i++) {
  button(`upper.${i + 1}`, `Upper ${i + 1}`, 102 + i, 230 + i * 60, 86, { led: 'rgb', w: 54, h: 20 });
  button(`lower.${i + 1}`, `Lower ${i + 1}`, 20 + i, 230 + i * 60, 268, { led: 'rgb', w: 54, h: 20 });
  // Scene 1 (CC 36, "1/4") is the top button.
  button(`scene.${i + 1}`, `Scene ${i + 1}`, 36 + i, 716, PAD.y0 + i * (PAD.size + PAD.gap) + 12, { led: 'rgb', w: 44, h: 30 });
}

// Left column (top to bottom), schematic.
const L = 20;
button('tap', 'Tap Tempo', 3, L, 92);
button('metronome', 'Metronome', 9, L + 72, 92);
button('delete', 'Delete', 118, L, 130);
button('undo', 'Undo', 119, L + 72, 130);
button('save', 'Save', 82, L, 162, { verify: true });
button('lock', 'Lock', 83, L + 72, 162, { verify: true });
button('mute', 'Mute', 60, L, 200, { led: 'rgb' });
button('solo', 'Solo', 61, L + 72, 200, { led: 'rgb' });
button('stop', 'Stop Clip', 29, L, 232, { led: 'rgb' });
button('convert', 'Convert', 35, L, 300);
button('double', 'Double Loop', 117, L, 332);
button('quantize', 'Quantize', 116, L, 364);
button('duplicate', 'Duplicate', 88, L, 396);
button('fixed', 'Fixed Length', 90, L, 428);
button('automate', 'Automate', 89, L, 460, { led: 'rgb' });
button('new', 'New', 92, L, 492, { verify: true });
button('capture', 'Capture', 65, L, 524, { verify: true });
button('record', 'Record', 86, L, 690, { led: 'rgb', h: 34 });
button('play', 'Play', 85, L, 732, { led: 'rgb', h: 34 });

// Top-right block.
const R = 800;
button('sets', 'Sets', 80, R, 22, { verify: true });
button('setup', 'Setup', 30, R + 72, 22);
button('learn', 'Learn', 81, R + 144, 22, { verify: true });
// The User button toggles User Mode in Live and must never be remapped or lit by us.
add({ id: 'user', label: 'User', kind: 'button', cc: 59, led: 'none', reserved: true, x: R + 216, y: 22, w: 64, h: 26 });
button('master', 'Main', 28, 716, 268, { w: 44, h: 20 });
button('swap', 'Swap', 33, R, 92, { verify: true });
button('add', 'Add', 32, R + 72, 92, { verify: true });
button('device', 'Device', 110, R, 124);
button('mix', 'Mix', 112, R + 72, 124);
button('clip', 'Clip', 113, R, 156);
button('sessionScreen', 'Session Screen', 34, R + 72, 156, { verify: true });

// Jog wheel nudges and press.
button('jog.press', 'Jog press', 94, 1040, 418, { verify: true, w: 80 });
button('jog.left', 'Jog nudge L', 93, 960, 356, { verify: true, w: 72 });
button('jog.right', 'Jog nudge R', 95, 1126, 356, { verify: true, w: 72 });
button('volume.press', 'Volume press', 111, 1100, 74, { verify: true, w: 66, h: 20 });
button('tempo.press', 'Tempo press', 15, 104, 36, { verify: true, w: 66, h: 20 });

// Right column, lower block.
button('note', 'Note', 50, R, 470);
button('session', 'Session', 51, R + 72, 470);
button('scale', 'Scale', 58, R, 502);
button('layout', 'Layout', 31, R + 72, 502);
button('repeat', 'Repeat', 56, R, 534);
button('accent', 'Accent', 57, R + 72, 534);
button('octDown', 'Octave Down', 54, R, 576);
button('octUp', 'Octave Up', 55, R + 72, 576);
button('pageLeft', 'Page Left', 62, R, 608);
button('pageRight', 'Page Right', 63, R + 72, 608);
button('shift', 'Shift', 49, R, 650);
button('select', 'Select', 48, R + 72, 650);

// D-pad.
button('up', 'Up', 46, 1020, 560, { w: 50 });
button('left', 'Left', 44, 962, 592, { w: 50 });
button('center', 'Center', 91, 1020, 592, { w: 50, verify: true });
button('right', 'Right', 45, 1078, 592, { w: 50 });
button('down', 'Down', 47, 1020, 624, { w: 50 });

// Pedals (no LED).
button('foot1', 'Footswitch 1', 64, 960, 732, { led: 'none' });
button('foot2', 'Footswitch 2', 69, 1040, 732, { led: 'none' });

const byId = new Map(controls.map((c) => [c.id, c]));

// Input lookup tables.
const padByNote = new Map();
const buttonByCc = new Map();
const encoderByCc = new Map();
const encoderByTouchNote = new Map();
for (const c of controls) {
  if (c.kind === 'pad') padByNote.set(c.note, c);
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
  STRIP_TOUCH_NOTE: strip.touchNote,
  USER_BUTTON_CC: 59,
};
