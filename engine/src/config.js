'use strict';
// Configuration model: global settings + pages, each page mapping control ids to actions.
// Everything coming from disk or the editor goes through normalizeConfig(), so the engine
// can rely on complete, in-range values and never crash on a bad file.

const push3 = require('./push3');
const { COLORS, dimOf } = require('./palette');
const live = require('./live');

const CONFIG_VERSION = 1;
const MAX_PAGES = 16;

const PAGE_COLORS = [COLORS.mint, COLORS.blue, COLORS.orange, COLORS.pink, COLORS.yellow, COLORS.purple, COLORS.cyan, COLORS.red];

const BUTTON_TYPES = ['none', 'note', 'cc', 'pc', 'page', 'pageHold', 'pageNext', 'pagePrev', 'variation', 'live'];
const BEHAVIORS = ['momentary', 'toggle', 'trigger'];
const ENCODER_TYPES = ['none', 'cc', 'live'];
const ENCODER_MODES = ['absolute', 'relative2c', 'relativeOffset'];
const STRIP_TYPES = ['none', 'pitchbend', 'cc'];
const PRESSURE_TYPES = ['off', 'polyAT', 'channelAT', 'cc'];
const VARIATION_ACTIONS = ['recall', 'store', 'delete', 'recallLast', 'randomize'];

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function oneOf(v, list, dflt) {
  return list.includes(v) ? v : dflt;
}

function str(v, dflt = '', max = 64) {
  return typeof v === 'string' ? v.slice(0, max) : dflt;
}

function defaultSettings() {
  return {
    baseChannel: 5, // 1-16; page n uses baseChannel + n unless the page sets its own channel
    disableMpeInUserMode: true,
    stripFader: false, // touch strip as a non-returning fader (mod wheel mode) while in User Mode
    pageButtons: 'upper', // 'upper' = upper display buttons select pages 1-8, 'none'
    unmappedLeds: 'off', // 'off' | 'dim' (show the layout of unmapped controls dimly)
    internalClock: true, // drive blink/pulse LED animations when Live sends no clock
    display: 'editor', // 'editor' = preview in the editor only, 'takeover' = also drive the Push display in User Mode
    shiftLayer: true, // Shift is a modifier: controls with a shift mapping do something else while it is held
  };
}

function defaultPadMapping(page, ctl) {
  const color = PAGE_COLORS[page % PAGE_COLORS.length];
  return {
    type: 'note',
    number: ctl.note,
    behavior: 'momentary',
    velocity: 'dynamic',
    onValue: 127,
    offValue: 0,
    colorOn: COLORS.white,
    colorOff: dimOf(color),
    anim: 'none',
    pressure: 'off',
    pressureCc: 1,
  };
}

function defaultButtonMapping(page, ctl) {
  return {
    type: 'cc',
    number: ctl.cc,
    behavior: 'momentary',
    velocity: 'fixed',
    onValue: 127,
    offValue: 0,
    colorOn: ctl.led === 'rgb' ? PAGE_COLORS[page % PAGE_COLORS.length] : 127,
    colorOff: ctl.led === 'rgb' ? COLORS.dark : 16,
    anim: 'none',
  };
}

function defaultEncoderMapping(page, ctl) {
  return {
    type: 'cc',
    number: ctl.cc,
    mode: 'absolute',
    sensitivity: 0.5,
    min: 0,
    max: 127,
    touch: 'none', // 'none' | 'note'
    touchNumber: ctl.touchNote,
  };
}

function defaultStripMapping() {
  return { type: 'pitchbend', number: 1 };
}

function defaultMapping(page, ctl) {
  switch (ctl.kind) {
    case 'pad':
      return defaultPadMapping(page, ctl);
    case 'button':
      return defaultButtonMapping(page, ctl);
    case 'touch':
      return { ...defaultButtonMapping(page, { ...ctl, cc: ctl.note }), type: 'none' };
    case 'encoder':
      return defaultEncoderMapping(page, ctl);
    case 'touchstrip':
      return defaultStripMapping();
    default:
      return { type: 'none' };
  }
}

function defaultPage(index) {
  const controls = {};
  for (const ctl of push3.controls) {
    if (ctl.reserved) continue;
    controls[ctl.id] = defaultMapping(index, ctl);
  }
  return { name: `Page ${index + 1}`, channel: 0, color: PAGE_COLORS[index % PAGE_COLORS.length], controls };
}

function defaultConfig(pageCount = 4) {
  const pages = [];
  for (let i = 0; i < pageCount; i++) pages.push(defaultPage(i));
  return { version: CONFIG_VERSION, settings: defaultSettings(), pages };
}

function normalizeButton(m, page, ctl, isShift = false) {
  const d = isShift ? { ...defaultMapping(page, ctl), type: 'none' } : defaultMapping(page, ctl);
  if (!m || typeof m !== 'object') return d;
  const out = {
    type: oneOf(m.type, BUTTON_TYPES, d.type),
    number: clampInt(m.number, 0, 127, d.number),
    channel: clampInt(m.channel, 0, 16, 0), // 0 = page channel
    behavior: oneOf(m.behavior, BEHAVIORS, d.behavior),
    velocity: oneOf(m.velocity, ['dynamic', 'fixed'], d.velocity),
    onValue: clampInt(m.onValue, 0, 127, d.onValue),
    offValue: clampInt(m.offValue, 0, 127, d.offValue),
    colorOn: clampInt(m.colorOn, 0, 127, d.colorOn),
    colorOff: clampInt(m.colorOff, 0, 127, d.colorOff),
    anim: oneOf(m.anim, Object.keys(push3.ANIMATIONS), 'none'),
    group: str(m.group, '', 32),
    label: str(m.label, '', 24),
  };
  if (ctl.kind === 'pad') {
    out.pressure = oneOf(m.pressure, PRESSURE_TYPES, 'off');
    out.pressureCc = clampInt(m.pressureCc, 0, 127, 1);
  }
  if (out.type === 'page' || out.type === 'pageHold') out.page = clampInt(m.page, 0, MAX_PAGES - 1, 0);
  if (out.type === 'variation') {
    out.target = {
      track: str(m.target && m.target.track, 'selected', 64) || 'selected',
      device: str(m.target && m.target.device, 'first', 64) || 'first',
    };
    out.index = clampInt(m.index, 0, 127, 0);
    out.action = oneOf(m.action, VARIATION_ACTIONS, 'recall');
  }
  if (out.type === 'live') {
    const l = m.live && typeof m.live === 'object' ? m.live : {};
    out.live = {
      action: oneOf(l.action, live.BUTTON_ACTIONS, 'mute'),
      track: str(l.track, 'selected', 64) || 'selected',
      scene: clampInt(l.scene, 0, 999, 0), // 0 = selected scene
      trackColor: l.trackColor !== false, // light in the track's colour when on
    };
  }
  if (!isShift) attachShift(out, m, (x) => normalizeButton(x, page, ctl, true));
  return out;
}

// Optional alternate mapping used while Shift is held (stored only when it does something).
function attachShift(out, m, normalize) {
  if (m && m.shift && typeof m.shift === 'object') {
    const sh = normalize(m.shift);
    if (sh.type !== 'none') out.shift = sh;
  }
}

function normalizeEncoder(m, page, ctl, isShift = false) {
  const d = isShift ? { ...defaultEncoderMapping(page, ctl), type: 'none' } : defaultEncoderMapping(page, ctl);
  if (!m || typeof m !== 'object') return d;
  const min = clampInt(m.min, 0, 127, d.min);
  const max = clampInt(m.max, 0, 127, d.max);
  const out = {
    type: oneOf(m.type, ENCODER_TYPES, d.type),
    number: clampInt(m.number, 0, 127, d.number),
    channel: clampInt(m.channel, 0, 16, 0),
    mode: oneOf(m.mode, ENCODER_MODES, d.mode),
    sensitivity: clampNum(m.sensitivity, 0.05, 8, d.sensitivity),
    min: Math.min(min, max),
    max: Math.max(min, max),
    touch: oneOf(m.touch, ['none', 'note'], d.touch),
    touchNumber: clampInt(m.touchNumber, 0, 127, d.touchNumber),
    label: str(m.label, '', 24),
  };
  if (out.type === 'live') {
    const l = m.live && typeof m.live === 'object' ? m.live : {};
    out.live = {
      target: oneOf(l.target, live.ENCODER_TARGETS, 'volume'),
      track: str(l.track, 'selected', 64) || 'selected',
      device: str(l.device, 'first', 64) || 'first',
      index: clampInt(l.index, 1, 128, 1),
    };
  }
  if (!isShift) attachShift(out, m, (x) => normalizeEncoder(x, page, ctl, true));
  return out;
}

function normalizeStrip(m) {
  const d = defaultStripMapping();
  if (!m || typeof m !== 'object') return d;
  return {
    type: oneOf(m.type, STRIP_TYPES, d.type),
    number: clampInt(m.number, 0, 127, d.number),
    channel: clampInt(m.channel, 0, 16, 0),
    label: str(m.label, '', 24),
  };
}

function normalizeMapping(m, page, ctl) {
  if (ctl.kind === 'pad' || ctl.kind === 'button' || ctl.kind === 'touch') return normalizeButton(m, page, ctl);
  if (ctl.kind === 'encoder') return normalizeEncoder(m, page, ctl);
  if (ctl.kind === 'touchstrip') return normalizeStrip(m);
  return { type: 'none' };
}

function normalizePage(p, index) {
  const src = p && typeof p === 'object' ? p : {};
  const srcControls = src.controls && typeof src.controls === 'object' ? src.controls : null;
  const controls = {};
  for (const ctl of push3.controls) {
    if (ctl.reserved) continue;
    // A page saved without this control (e.g. an older version) gets the default.
    controls[ctl.id] = srcControls && ctl.id in srcControls ? normalizeMapping(srcControls[ctl.id], index, ctl) : defaultMapping(index, ctl);
  }
  return {
    name: str(src.name, `Page ${index + 1}`, 24) || `Page ${index + 1}`,
    channel: clampInt(src.channel, 0, 16, 0),
    color: clampInt(src.color, 0, 127, PAGE_COLORS[index % PAGE_COLORS.length]),
    controls,
  };
}

function normalizeConfig(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  const ds = defaultSettings();
  const s = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const settings = {
    baseChannel: clampInt(s.baseChannel, 1, 16, ds.baseChannel),
    disableMpeInUserMode: typeof s.disableMpeInUserMode === 'boolean' ? s.disableMpeInUserMode : ds.disableMpeInUserMode,
    stripFader: typeof s.stripFader === 'boolean' ? s.stripFader : ds.stripFader,
    pageButtons: oneOf(s.pageButtons, ['upper', 'none'], ds.pageButtons),
    unmappedLeds: oneOf(s.unmappedLeds, ['off', 'dim'], ds.unmappedLeds),
    internalClock: typeof s.internalClock === 'boolean' ? s.internalClock : ds.internalClock,
    display: oneOf(s.display, ['editor', 'takeover'], ds.display),
    shiftLayer: typeof s.shiftLayer === 'boolean' ? s.shiftLayer : ds.shiftLayer,
  };
  const srcPages = Array.isArray(src.pages) && src.pages.length ? src.pages.slice(0, MAX_PAGES) : defaultConfig().pages;
  const pages = srcPages.map((p, i) => normalizePage(p, i));
  return { version: CONFIG_VERSION, settings, pages };
}

// MIDI channel (0-15) a page sends on.
function pageChannel(config, pageIndex) {
  const page = config.pages[pageIndex];
  if (page && page.channel) return page.channel - 1;
  return (config.settings.baseChannel - 1 + pageIndex) % 16;
}

module.exports = {
  CONFIG_VERSION,
  MAX_PAGES,
  PAGE_COLORS,
  BUTTON_TYPES,
  BEHAVIORS,
  ENCODER_MODES,
  defaultConfig,
  defaultPage,
  defaultMapping,
  normalizeConfig,
  normalizeMapping,
  pageChannel,
};
