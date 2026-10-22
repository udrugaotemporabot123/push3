'use strict';
// Builds what the Push display shows from engine state, and draws it on a Canvas.
//
//  y   0-22  upper display buttons: page names (current page highlighted)
//  y  28-48  encoder labels (8 columns of 120 px, one per encoder)
//  y  52-96  encoder values + value bars
//  y 104-130 status line: page / channel / last action (big when something just happened)
//  y 138-160 lower display buttons: labels with their LED colour

const push3 = require('../push3');
const { pageChannel } = require('../config');

const COL = 120;
const GREY = [110, 116, 124];
const DIM = [52, 56, 62];
const WHITE = [235, 238, 240];

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
  };
  for (let i = 1; i <= 8; i++) {
    const ctl = push3.byId.get(`upper.${i}`);
    if (cfg.settings.pageButtons === 'upper') {
      const p = cfg.pages[i - 1];
      model.upper.push(p ? { label: p.name, color: hexToRgb(palette[p.color]), active: i - 1 === engine.page } : null);
    } else {
      const m = page.controls[ctl.id];
      const led = engine.ledFor(ctl);
      model.upper.push({ label: summary(ctl, m), color: led && led.color ? hexToRgb(palette[led.color]) : DIM, active: !!(led && led.color && m && engine.ctlState(engine.page, ctl.id).on) });
    }
    const enc = push3.byId.get(`enc.${i}`);
    const em = page.controls[enc.id];
    const st = engine.ctlState(engine.page, enc.id);
    model.encoders.push({
      label: em && em.type !== 'none' ? summary(enc, em) : '',
      value: em && em.type === 'cc' && em.mode === 'absolute' ? (st.value === null ? null : Math.round(st.value)) : undefined,
      min: em ? em.min : 0,
      max: em ? em.max : 127,
      relative: !!(em && em.type === 'cc' && em.mode !== 'absolute'),
      touched: engine.pressed.has(enc.id),
    });
    const low = push3.byId.get(`lower.${i}`);
    const lm = page.controls[low.id];
    const lled = engine.ledFor(low);
    model.lower.push({ label: summary(low, lm), color: lled && lled.color ? hexToRgb(palette[lled.color]) : null, on: !!(lm && engine.ctlState(engine.page, low.id).on) });
  }
  return model;
}

function draw(canvas, model) {
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
    const txt = e.value === null || e.value === undefined ? '–' : String(e.value);
    canvas.text(x + COL / 2, 52, txt, { font: 'big', color: e.touched ? WHITE : [200, 204, 208], align: 'center' });
    const range = Math.max(1, e.max - e.min);
    const frac = e.value === null || e.value === undefined ? 0 : Math.min(1, Math.max(0, (e.value - e.min) / range));
    canvas.fillRect(x + 12, 88, COL - 24, 4, [34, 37, 42]);
    canvas.fillRect(x + 12, 88, Math.round((COL - 24) * frac), 4, model.pageColor);
  });

  // Status / last action line.
  canvas.fillRect(0, 100, 960, 1, [28, 30, 34]);
  if (model.action) {
    canvas.text(12, 104, model.action.title, { font: 'bold', color: WHITE, maxWidth: 520 });
    canvas.text(948, 104, model.action.detail || '', { font: 'bold', color: model.pageColor, align: 'right', maxWidth: 400 });
  } else {
    canvas.text(12, 106, model.pageName, { font: 'bold', color: model.pageColor, maxWidth: 520 });
    canvas.text(948, 108, `ch ${model.channel} · USER MODE`, { font: 'small', color: GREY, align: 'right' });
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

module.exports = { buildModel, draw, summary };
