'use strict';
// Tablet player: where you are (track, rack in use, variation) and quick control of the rack's macros and
// variations. Talks to the engine over the editor's WebSocket; the engine asks Live only after an action.
// Layout stays fixed (always 16 macro slots, 24+ variation slots) so nothing moves under your fingers.

const $ = (s) => document.querySelector(s);
const S = { screen: null, macros: null, ws: null, dragging: new Map(), pending: -1, pendingTimer: null, armed: false, armTimer: null, confirm: -1, confirmTimer: null };
const ARM_MS = 4000; // "+" then nothing: a new variation in the next free slot after this

function rgb(c, k = 1) {
  const a = c || [128, 128, 128];
  return `rgb(${Math.round(a[0] * k)},${Math.round(a[1] * k)},${Math.round(a[2] * k)})`;
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function send(msg) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg));
}
const act = (a, extra = {}) => send({ t: 'pAction', a, ...extra });

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => send({ t: 'player' });
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (m.t === 'screen') {
      S.screen = m.screen;
      const v = S.screen.vars || {};
      if (S.pending >= 0 && v.selected === S.pending) clearPending();
      render();
    } else if (m.t === 'macros') {
      S.macros = m.macros;
      renderMacros();
      render(); // names of the variations come with the macros
    } else if (m.t === 'macro' && S.macros && m.rackId === S.macros.rackId) {
      const i = S.macros.items.findIndex((x) => x.i === m.item.i);
      if (i >= 0 && !S.dragging.has(m.item.i)) {
        S.macros.items[i] = m.item;
        updateKnob(m.item);
      }
    } else if (m.t === 'notice') notice(m.text);
  };
  ws.onclose = () => {
    $('#mode').textContent = 'nije spojeno…';
    $('#mode').className = 'chip off';
    setTimeout(connect, 1500);
  };
}

let noticeTimer = null;
function notice(text) {
  const n = $('#notice');
  n.textContent = text;
  n.classList.add('on');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => n.classList.remove('on'), 2600);
}

function render() {
  const s = S.screen || {};
  const v = s.vars || { count: 0, selected: -1 };
  const where = $('#where');
  where.innerHTML = '';
  where.append(
    el('b', { style: `color:${s.track ? rgb(s.track.rgb) : ''}` }, s.track ? s.track.name : 'Pritisni Rackovi'),
    s.rack ? ' · ' : '',
    s.rack ? el('b', { style: `color:${rgb(s.rack.rgb)}` }, s.rack.name) : '',
    v.selected >= 0 ? ` · ${varLabel(v.selected)}` : '',
  );
  $('#mode').textContent = s.mode === 'user' ? 'USER' : 'LIVE';
  $('#mode').className = `chip ${s.mode === 'user' ? 'user' : ''}`;

  const tr = $('#tracks');
  tr.innerHTML = '';
  for (const t of s.tracks || []) {
    tr.append(el('button', { class: t.id === s.selectedTrack ? 'sel' : '', style: `border-left-color:${rgb(t.rgb)}`, onclick: () => act('track', { id: t.id }) }, t.name));
  }
  if (!(s.tracks || []).length) tr.append(el('span', { class: 'muted' }, 'Nema popisa trackova: pritisni Rackovi.'));

  const rk = $('#racks');
  rk.innerHTML = '';
  (s.racks || []).forEach((r, i) => {
    rk.append(el('button', { class: r.inUse ? 'inuse' : r.present ? '' : 'absent', style: `background:${rgb(r.rgb)}`, onclick: () => r.present && act('rack', { i }) }, r.label));
  });
  renderVars();
  if (!S.macros) renderMacros();
}

// Variation numbers as the Push shows them (0 = first); names where Live gives them.
function varName(i) {
  const names = (S.macros && S.macros.varNames) || [];
  return names[i] || '';
}
function varLabel(i) {
  const n = varName(i);
  return n ? `${i} ${n}` : `VAR ${i}`;
}

function renderVars() {
  const s = S.screen || {};
  const v = s.vars || { count: 0, selected: -1 };
  const vg = $('#vars');
  vg.innerHTML = '';
  const slots = Math.max(24, Math.ceil((v.count + 1) / 8) * 8);
  const rackRgb = s.rack ? s.rack.rgb : [0, 80, 255];
  for (let i = 0; i < slots; i++) {
    if (i === v.count) {
      // The "+" sits in the next free slot: tap = arm (then tap a variation to overwrite it, or wait = new).
      vg.append(el('button', { class: `add${S.armed ? ' armed' : ''}`, onclick: onAdd, title: 'Spremi makroe kao varijaciju' }, '+'));
      continue;
    }
    const exists = i < v.count;
    if (!exists) {
      vg.append(el('button', { class: 'none', onclick: () => S.armed && storeNew() }, String(i)));
      continue;
    }
    const name = varName(i);
    const cls = [i === v.selected ? 'sel' : '', i === S.pending ? 'pending' : '', i === S.confirm ? 'confirm' : ''].join(' ').trim();
    const label = i === S.confirm ? 'Prepiši? Dodirni opet' : null;
    vg.append(el('button', { class: cls, style: `background:${rgb(rackRgb)}`, onclick: () => onVar(i) }, label || (name ? el('small', {}, String(i)) : String(i)), label || !name ? null : name));
  }
  $('#btnDelete').disabled = !(v.selected >= 0);
}

function onVar(i) {
  if (S.confirm === i) {
    // Second tap: overwrite = Live deletes the old one and stores the current macros as a new one at the end.
    clearConfirm();
    disarm();
    act('overwrite', { index: i });
    notice(`Prepisano: stara ${i} obrisana, nova spremljena na kraj (Live ne zna prepisati na istom mjestu)`);
    return;
  }
  if (S.armed) {
    S.confirm = i;
    clearTimeout(S.confirmTimer);
    S.confirmTimer = setTimeout(() => {
      clearConfirm();
      renderVars();
    }, 3000);
    clearTimeout(S.armTimer); // waiting for the confirmation instead
    renderVars();
    return;
  }
  // Immediate feedback: Live takes a moment to recall, the tap must show at once.
  clearPending();
  S.pending = i;
  S.pendingTimer = setTimeout(() => {
    clearPending();
    renderVars();
  }, 2500);
  renderVars();
  act('variation', { index: i });
}

function onAdd() {
  if (S.armed) return storeNew(); // second tap on "+": store right away
  S.armed = true;
  $('#hint').textContent = 'Dodirni varijaciju koju prepisuješ, ili pričekaj: spremit će se kao nova.';
  S.armTimer = setTimeout(storeNew, ARM_MS);
  renderVars();
}

function storeNew() {
  disarm();
  clearConfirm();
  act('store');
  notice('Spremljena nova varijacija');
}

function disarm() {
  S.armed = false;
  clearTimeout(S.armTimer);
  $('#hint').textContent = '';
  renderVars();
}

function clearConfirm() {
  S.confirm = -1;
  clearTimeout(S.confirmTimer);
}

function clearPending() {
  S.pending = -1;
  clearTimeout(S.pendingTimer);
}

function renderMacros() {
  const box = $('#macros');
  box.innerHTML = '';
  const m = S.macros;
  const items = (m && m.items) || [];
  // Always 16 slots (two rows), so the layout never jumps between racks with 8 and 16 macros.
  for (let i = 1; i <= 16; i++) {
    const it = items.find((x) => x.i === i);
    box.append(it ? knob(it) : el('div', { class: 'knob empty' }));
  }
}

function knob(it) {
  const fill = el('div', { class: 'fill' });
  const val = el('div', { class: 'val' });
  const k = el('div', { class: 'knob', 'data-i': it.i }, fill, el('div', { class: 'lbl' }, it.name), val);
  k._fill = fill;
  k._val = val;
  paint(k, it.value, it.text);
  // Drag up/down anywhere on the tile (relative, so a touch never jumps the value).
  let startY = 0;
  let startV = 0;
  let lastSent = 0;
  let pending = null;
  const flush = () => {
    if (pending === null) return;
    act('macro', { index: it.i, value: pending });
    pending = null;
    lastSent = Date.now();
  };
  k.addEventListener('pointerdown', (e) => {
    k.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startV = currentValue(it.i);
    S.dragging.set(it.i, startV);
  });
  k.addEventListener('pointermove', (e) => {
    if (!S.dragging.has(it.i)) return;
    const v = Math.max(0, Math.min(1, startV + (startY - e.clientY) / 220));
    S.dragging.set(it.i, v);
    paint(k, v, '');
    pending = v;
    if (Date.now() - lastSent > 40) flush(); // about 25 updates a second at most
  });
  const end = () => {
    if (!S.dragging.has(it.i)) return;
    const v = S.dragging.get(it.i);
    S.dragging.delete(it.i);
    flush();
    setValue(it.i, v);
  };
  k.addEventListener('pointerup', end);
  k.addEventListener('pointercancel', end);
  return k;
}

function currentValue(i) {
  const it = S.macros && S.macros.items.find((x) => x.i === i);
  return it ? it.value : 0;
}

function setValue(i, v) {
  const it = S.macros && S.macros.items.find((x) => x.i === i);
  if (it) it.value = v;
}

function paint(k, v, text) {
  const rackRgb = S.screen && S.screen.rack ? S.screen.rack.rgb : [255, 122, 26];
  k._fill.style.height = `${Math.round(v * 100)}%`;
  k._fill.style.background = rgb(rackRgb, 0.75);
  k._val.textContent = text || `${Math.round(v * 127)}`;
}

function updateKnob(it) {
  const k = document.querySelector(`.knob[data-i="${it.i}"]`);
  if (k) paint(k, it.value, it.text);
}

function fullscreen() {
  const d = document.documentElement;
  const req = d.requestFullscreen || d.webkitRequestFullscreen;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (req) {
    Promise.resolve(req.call(d)).catch(() => notice('Cijeli ekran: Dijeli → Dodaj na početni zaslon, pa otvori ikonu'));
  } else notice('Cijeli ekran: Dijeli → Dodaj na početni zaslon, pa otvori ikonu');
}

$('#btnRefresh').onclick = () => act('refresh');
$('#btnRescan').onclick = () => act('rescan');
$('#btnFull').onclick = fullscreen;
$('#btnRandom').onclick = () => act('randomize');
$('#btnDelete').onclick = () => {
  const v = S.screen && S.screen.vars;
  if (!v || v.selected < 0) return;
  const b = $('#btnDelete');
  if (b.dataset.armed) {
    delete b.dataset.armed;
    b.textContent = 'Obriši odabranu';
    act('variation', { action: 'delete', index: v.selected });
  } else {
    b.dataset.armed = '1';
    b.textContent = `Sigurno obrisati ${varLabel(v.selected)}? Dodirni opet`;
    setTimeout(() => {
      delete b.dataset.armed;
      b.textContent = 'Obriši odabranu';
    }, 3000);
  }
};

renderMacros();
connect();
