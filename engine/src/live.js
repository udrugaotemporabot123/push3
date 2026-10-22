'use strict';
// Live-aware mappings: controls that act on Live directly through the Live API bridge
// (p3um-live.js) instead of sending MIDI, with real state/feedback coming back.

const BUTTON_ACTIONS = ['mute', 'solo', 'arm', 'select', 'scene', 'play', 'stop', 'record', 'metronome', 'overdub', 'tap', 'undo', 'redo', 'capture', 'param', 'clip', 'clipDelete', 'stopTrack', 'trackPrev', 'trackNext', 'scenePrev', 'sceneNext', 'devicePrev', 'deviceNext'];
const PARAM_MODES = ['toggle', 'momentary', 'trigger'];
const ENCODER_TARGETS = ['volume', 'pan', 'send', 'macro', 'deviceParam', 'named', 'tempo'];

// What to observe for a button action (null = nothing to show).
function specForButton(live) {
  if (!live) return null;
  switch (live.action) {
    case 'mute':
    case 'solo':
    case 'arm':
      return { t: 'trackProp', track: live.track, prop: live.action };
    case 'select':
      return { t: 'trackSelect', track: live.track };
    case 'play':
      return { t: 'song', prop: 'is_playing' };
    case 'record':
      return { t: 'song', prop: 'session_record' };
    case 'metronome':
      return { t: 'song', prop: 'metronome' };
    case 'overdub':
      return { t: 'song', prop: 'arrangement_overdub' };
    case 'param':
      return { t: 'param', target: 'named', track: live.track, device: live.device, param: live.param };
    case 'clip':
    case 'clipDelete':
      return { t: 'slot', track: live.track, scene: live.scene };
    default:
      return null;
  }
}

function specForEncoder(live) {
  if (!live) return null;
  const spec = { t: 'param', target: live.target, track: live.track };
  if (live.target === 'send') spec.index = live.index;
  if (live.target === 'macro') {
    spec.device = live.device;
    spec.index = live.index;
  }
  if (live.target === 'deviceParam') spec.index = live.index;
  if (live.target === 'named') {
    spec.device = live.device;
    spec.param = live.param;
  }
  if (live.target === 'tempo') return { t: 'param', target: 'tempo' };
  return spec;
}

// Stable key for a spec (property order independent).
function liveKey(spec) {
  return JSON.stringify(Object.keys(spec)
    .sort()
    .reduce((o, k) => ((o[k] = spec[k]), o), {}));
}

// Push palette index closest to an RGB colour (for "use track colour" LEDs).
function nearestPaletteIndex(rgb, palette) {
  let best = 0;
  let bestD = Infinity;
  // Only the bright/full entries (4..63, groups of four) and white, so LEDs stay saturated.
  for (let i = 3; i < 64; i++) {
    if (i > 3 && (i - 4) % 4 > 1) continue;
    const h = palette[i];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Clip slot states reported by the bridge.
const SLOT = { EMPTY: 0, STOPPED: 1, PLAYING: 2, RECORDING: 3, TRIGGERED: 4 };

module.exports = { SLOT, BUTTON_ACTIONS, PARAM_MODES, ENCODER_TARGETS, specForButton, specForEncoder, liveKey, nearestPaletteIndex };
