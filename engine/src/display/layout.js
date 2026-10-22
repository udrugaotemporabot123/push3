'use strict';
// Builds what the Push display shows from engine state, and draws it on a Canvas.
//
//  y   0-22  upper display buttons: page names (current page highlighted)
//  y  28-48  encoder labels (8 columns of 120 px, one per encoder)
//  y  52-96  encoder values + value bars
//  y 104-130 status line: page / channel / last action (big when something just happened)
//  y 138-160 lower display buttons: labels with their LED colour

const push3 = require('../push3');
const { pageChannel, range14 } = require('../config');
const { liveKey } = require('../live');

const TEMPO_KEY = liveKey({ t: 'param', target: 'tempo' });
const PLAY_KEY = liveKey({ t: 'song', prop: 'is_playing' });

const COL = 120;
const GREY = [110, 116, 124];
const DIM = [52, 56, 62];
const WHITE = [235, 238, 240];

const LIVE_LABELS = { mute: 'Mute', solo: 'Solo', arm: 'Arm', select: 'Select', scene: 'Scene', play: 'Play', stop: 'Stop', record: 'Rec', metronome: 'Metro', overdub: 'Overdub', tap: 'Tap', undo: 'Undo', redo: 'Redo', capture: 'Capture', volume: 'Volume', pan: 'Pan', send: 'Send', macro: 'Macro', deviceParam: 'Param', padParam: 'Pad', tempo: 'Tempo' };

function hexToRgb(hex) {
  const s = String(hex || '000000');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function summary(ctl, m) {
  if (!m || m.type === 'none') return '';
  if (m.label) return m.label;
  switch (m.type) {
    case 'note':
      return `Note ${m.number}`;
    case 'cc':
      return `CC ${m.number}`;
    case 'pc':
      return `PC ${m.number}`;
    case 'pitchbend':
      return 'Pitch bend';
    case 'variation':
      return `Var ${m.index + 1}`;
    case 'live':
      return m.live ? LIVE_LABELS[m.live.action || m.live.target] || m.live.action || m.live.target : 'Live';
    case 'page':
      return `→ P${m.page + 1}`;
    case 'pageNext':
      return 'Page →';
    case 'pagePrev':
      return '← Page';
    default:
      return m.type;
  }
}

// Label for a button: Live-aware mappings show the real track/parameter name.
function buttonLabel(engine, ctl, m) {
  if (m && m.type === 'live' && !m.label) {
    const v = engine.liveValue(m);
    const base = summary(ctl, m);
    if (v && v.ok && v.name && ['mute', 'solo', 'arm', 'select'].includes(m.live.action)) return m.live.action === 'select' ? v.name : `${base} ${v.name}`;
  }
  if (m && m.type === 'addon' && !m.label && typeof engine.addonLabel === 'function') return engine.addonLabel(m) || summary(ctl, m);
  return summary(ctl, m);
}

function buildModel(engine, palette, lastAction, now) {
  const cfg = engine.config;
  const page = cfg.pages[engine.page];
  const model = {
    mode: engine.mode,
    pageName: page ? page.name : '',
    pageColor: page ? hexToRgb(palette[page.color]) : GREY,
    channel: pageChannel(cfg, engine.page) + 1,
    upper: [],
    encoders: [],
    lower: [],
    action: lastAction && now - lastAction.at < 1500 ? lastAction : null,
    display: page ? page.display : 'controls',
    transport: transportText(engine),
    status: typeof engine.addonStatus === 'function' ? engine.addonStatus().join('  ·  ') : '',
    view: null,
  };
  if (model.display === 'addon' && typeof engine.addonView === 'function') {
    const v = engine.addonView();
    if (v) model.view = { ...v, rows: v.rows.slice(0, 16).map((r) => ({ ...r, rgb: hexToRgb(palette[r.color] || '808080') })) };
  }
  for (let i = 1; i <= 8; i++) {
    const ctl = push3.byId.get(`upper.${i}`);
    if (cfg.settings.pageButtons === 'upper') {
      const p = cfg.pages[i - 1];
      model.upper.push(p ? { label: p.name, color: hexToRgb(palette[p.color]), active: i - 1 === engine.page } : null);
    } else {
      const m = engine.mapping(ctl.id);
      const led = engine.ledFor(ctl);
      model.upper.push({ label: buttonLabel(engine, ctl, m), color: led && led.color ? hexToRgb(palette[led.color]) : DIM, active: !!(led && led.color && m && engine.ctlState(engine.page, ctl.id).on) });
    }
    const enc = push3.byId.get(`enc.${i}`);
    const em = engine.mapping(enc.id);
    const st = engine.ctlState(engine.page, enc.id);
    const enc0 = { label: '', text: null, frac: 0, relative: false, touched: engine.pressed.has(enc.id) };
    if (em && em.type === 'live') {
      const v = engine.liveValue(em);
      const t = em.live.target;
      const trackLabel = v && v.ok && v.track ? (t === 'send' ? `${v.track} ${v.name.replace(/^.*?-/, '')}` : t === 'pan' ? `${v.track} pan` : v.track) : '';
      enc0.label = em.label || ((t === 'volume' || t === 'pan' || t === 'send') && trackLabel) || (v && v.ok && v.name) || summary(enc, em);
      enc0.text = v && v.ok ? v.display || String(Math.round(v.value * 127)) : '–';
      enc0.frac = v && v.ok ? v.value : 0;
    } else if (em && em.type === 'cc') {
      enc0.label = summary(enc, em);
      if (em.mode === 'absolute14') {
        const [lo, hi] = range14(em);
        enc0.text = st.value === null ? '–' : (st.value / 128).toFixed(1);
        enc0.frac = st.value === null ? 0 : (st.value - lo) / Math.max(1, hi - lo);
      } else if (em.mode !== 'absolute') enc0.relative = true;
      else {
        enc0.text = st.value === null ? '–' : String(Math.round(st.value));
        enc0.frac = st.value === null ? 0 : (st.value - em.min) / Math.max(1, em.max - em.min);
      }
    }
    model.encoders.push(enc0);
    const low = push3.byId.get(`lower.${i}`);
    const lm = engine.mapping(low.id);
    const lled = engine.ledFor(low);
    model.lower.push({ label: buttonLabel(engine, low, lm), color: lled && lled.color ? hexToRgb(palette[lled.color]) : null, on: !!(lm && engine.ctlState(engine.page, low.id).on) });
  }
  return model;
}

function transportText(engine) {
  const t = engine.liveState.values[TEMPO_KEY];
  const p = engine.liveState.values[PLAY_KEY];
  const parts = [];
  if (p && p.ok) parts.push(p.value ? '▶' : '■');
  if (t && t.ok && t.display) parts.push(t.display);
  return parts.join(' ');
}

function draw(canvas, model) {
  if (model.display === 'big') return drawBig(canvas, model);
  if (model.display === 'addon' && model.view) return drawView(canvas, model);
  canvas.clear([0, 0, 0]);
  // Upper row: page names / upper button labels.
  model.upper.forEach((u, i) => {
    const x = i * COL;
    if (!u) return;
    if (u.active) canvas.fillRect(x + 6, 0, COL - 12, 22, u.color);
    else canvas.fillRect(x + 6, 19, COL - 12, 3, u.color);
    canvas.text(x + COL / 2, 3, u.label, { font: 'small', color: u.active ? [0, 0, 0] : GREY, align: 'center', maxWidth: COL - 16 });
  });

  // Encoders.
  model.encoders.forEach((e, i) => {
    const x = i * COL;
    if (i > 0) canvas.fillRect(x, 30, 1, 66, [28, 30, 34]);
    if (!e.label) return;
    canvas.text(x + COL / 2, 30, e.label, { font: 'small', color: e.touched ? WHITE : GREY, align: 'center', maxWidth: COL - 12 });
    if (e.relative) {
      canvas.text(x + COL / 2, 56, '↑↓', { font: 'big', color: e.touched ? WHITE : DIM, align: 'center' });
      return;
    }
    const txt = e.text || '–';
    const small = model.encoders.some((o) => o.text && o.text.length > 4);
    canvas.text(x + COL / 2, small ? 58 : 52, txt, { font: small ? 'bold' : 'big', color: e.touched ? WHITE : [200, 204, 208], align: 'center', maxWidth: COL - 10 });
    const frac = Math.min(1, Math.max(0, e.frac || 0));
    canvas.fillRect(x + 12, 88, COL - 24, 4, [34, 37, 42]);
    canvas.fillRect(x + 12, 88, Math.round((COL - 24) * frac), 4, model.pageColor);
  });

  // Status / last action line.
  canvas.fillRect(0, 100, 960, 1, [28, 30, 34]);
  if (model.action) {
    canvas.text(12, 104, model.action.title, { font: 'bold', color: WHITE, maxWidth: 520 });
    canvas.text(948, 104, model.action.detail || '', { font: 'bold', color: model.pageColor, align: 'right', maxWidth: 400 });
  } else {
    canvas.text(12, 106, model.pageName, { font: 'bold', color: model.pageColor, maxWidth: model.status ? 300 : 520 });
    const right = model.status || `${model.transport ? `${model.transport} · ` : ''}ch ${model.channel}`;
    canvas.text(948, 108, right, { font: 'small', color: model.status ? WHITE : GREY, align: 'right', maxWidth: 620 });
  }

  // Lower row labels.
  canvas.fillRect(0, 134, 960, 1, [28, 30, 34]);
  model.lower.forEach((l, i) => {
    const x = i * COL;
    if (!l.label) return;
    if (l.color) canvas.fillRect(x + 6, 137, COL - 12, 3, l.color);
    canvas.text(x + COL / 2, 142, l.label, { font: 'small', color: l.on ? WHITE : GREY, align: 'center', maxWidth: COL - 14 });
  });
}

// Stage view: page name and last action large, transport on the side.
function drawBig(canvas, model) {
  canvas.clear([0, 0, 0]);
  canvas.fillRect(0, 0, 8, 160, model.pageColor);
  if (model.action) {
    canvas.text(28, 22, model.action.title, { font: 'big', color: WHITE, maxWidth: 900 });
    canvas.text(28, 70, model.action.detail || '', { font: 'big', color: model.pageColor, maxWidth: 900 });
  } else {
    canvas.text(28, 22, model.pageName, { font: 'big', color: model.pageColor, maxWidth: 900 });
    canvas.text(28, 70, model.status || `kanal ${model.channel}`, { font: 'bold', color: model.status ? WHITE : GREY, maxWidth: 900 });
  }
  if (model.transport) canvas.text(940, 126, model.transport, { font: 'bold', color: GREY, align: 'right' });
  // Lower button labels stay visible: they belong to the buttons right below the display.
  model.lower.forEach((l, i) => {
    if (!l.label) return;
    if (l.color) canvas.fillRect(i * COL + 6, 152, COL - 12, 3, l.color);
  });
}

// Add-on view: a grid (rows x cells), e.g. sequencer lanes x steps with the playhead.
function drawView(canvas, model) {
  const v = model.view;
  canvas.clear([0, 0, 0]);
  canvas.text(10, 2, v.title || model.pageName, { font: 'small', color: WHITE, maxWidth: 560 });
  canvas.text(950, 2, model.status || model.transport, { font: 'small', color: GREY, align: 'right', maxWidth: 380 });
  const rows = v.rows;
  const cols = Math.max(1, Math.min(64, v.columns || 16));
  const top = 20;
  const bottom = 134;
  const left = 80;
  const rowH = Math.max(4, Math.floor((bottom - top) / Math.max(1, rows.length)));
  const colW = (950 - left) / cols;
  rows.forEach((r, ri) => {
    const y = top + ri * rowH;
    if (r.selected) canvas.fillRect(0, y, 960, rowH, [24, 26, 30]);
    if (rowH >= 10) canvas.text(6, y + Math.max(0, (rowH - 12) / 2), r.label || '', { font: 'small', color: r.selected ? WHITE : GREY, maxWidth: left - 10 });
    for (let c = 0; c < cols; c++) {
      const x = Math.round(left + c * colW);
      const w = Math.max(2, Math.round(colW) - 2);
      const val = (r.cells || [])[c] || 0;
      let color;
      if (val < 0) color = [14, 15, 17]; // outside the loop
      else if (val > 0) {
        const k = 0.35 + 0.65 * Math.min(1, val / 127);
        color = r.rgb.map((ch) => Math.round(ch * k));
      } else color = c % 4 === 0 ? [44, 47, 52] : [30, 32, 36];
      canvas.fillRect(x, y + 1, w, rowH - 2, color);
    }
  });
  if (v.playhead >= 0 && v.playhead < cols) canvas.fillRect(Math.round(left + v.playhead * colW), top - 2, Math.max(2, Math.round(colW) - 2), 2, WHITE);
  canvas.fillRect(0, 136, 960, 1, [28, 30, 34]);
  model.lower.forEach((l, i) => {
    if (!l.label) return;
    if (l.color) canvas.fillRect(i * COL + 6, 139, COL - 12, 3, l.color);
    canvas.text(i * COL + COL / 2, 144, l.label, { font: 'small', color: l.on ? WHITE : GREY, align: 'center', maxWidth: COL - 14 });
  });
}

module.exports = { buildModel, draw, summary };
