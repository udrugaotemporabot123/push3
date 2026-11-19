'use strict';
// Tablet player: where you are (track, rack in use, variation) and quick control of the rack's macros and
// variations. Talks to the engine over the editor's WebSocket; the engine asks Live only after an action.

const $ = (s) => document.querySelector(s);
const S = { screen: null, macros: null, ws: null, dragging: new Map() };

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
  for (const c of kids) e.append(c);
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
      render();
    } else if (m.t === 'macros') {
      S.macros = m.macros;
      renderMacros();
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
  noticeTimer = setTimeout(() => n.classList.remove('on'), 2200);
}

function render() {
  const s = S.screen || {};
  $('#track i').style.background = rgb(s.track && s.track.rgb);
  $('#track span').textContent = s.track ? s.track.name : 'Klikni Rackovi';
  $('#rack').textContent = s.rack ? s.rack.name : '';
  $('#rack').style.color = s.rack ? rgb(s.rack.rgb) : '';
  const v = s.vars || { count: 0, selected: -1 };
  $('#var').textContent = v.selected >= 0 ? `VAR ${v.selected + 1} / ${v.count}` : v.count ? `${v.count} varijacija` : '';
  $('#mode').textContent = s.mode === 'user' ? 'USER MODE' : 'Live Mode';
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

  const vg = $('#vars');
  vg.innerHTML = '';
  const n = Math.max(24, v.count);
  const rackRgb = s.rack ? s.rack.rgb : [0, 80, 255];
  for (let i = 0; i < n; i++) {
    const exists = i < v.count;
    vg.append(el('button', { class: i === v.selected ? 'sel' : exists ? '' : 'none', style: exists ? `background:${rgb(rackRgb)}` : '', onclick: () => exists && act('variation', { index: i }) }, String(i + 1)));
  }
  $('#btnDelete').disabled = !(v.selected >= 0);
}

function renderMacros() {
  const box = $('#macros');
  box.innerHTML = '';
  const m = S.macros;
  $('#macroRack').textContent = m && m.name ? `· ${m.name}` : '';
  if (!m || !m.items.length) {
    box.append(el('span', { class: 'muted', style: 'grid-column:1/-1' }, 'Odaberi rack (ili ↻ Osvježi) da se pokažu makroi.'));
    return;
  }
  for (const it of m.items) box.append(knob(it));
}

function knob(it) {
  const fill = el('div', { class: 'fill' });
  const val = el('div', { class: 'val' });
  const k = el('div', { class: 'knob', 'data-i': it.i }, fill, el('div', { class: 'lbl' }, it.name), val);
  k._fill = fill;
  k._val = val;
  paint(k, it.value, it.text);
  // Drag up/down anywhere on the tile (relative, so a touch never jumps the value); double tap = 0.
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
    const v = Math.max(0, Math.min(1, startV + (startY - e.clientY) / (k.clientHeight * 1.5)));
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
  k._fill.style.background = rgb(rackRgb, 0.8);
  k._val.textContent = text || `${Math.round(v * 127)}`;
}

function updateKnob(it) {
  const k = document.querySelector(`.knob[data-i="${it.i}"]`);
  if (k) paint(k, it.value, it.text);
}

$('#btnRefresh').onclick = () => act('refresh');
$('#btnRescan').onclick = () => act('rescan');
$('#btnStore').onclick = () => act('store');
$('#btnRandom').onclick = () => act('randomize');
$('#btnDelete').onclick = () => {
  const v = S.screen && S.screen.vars;
  if (!v || v.selected < 0) return;
  // In-page confirmation (browser confirm() is blocked on some systems): a second tap within 3 s.
  const b = $('#btnDelete');
  if (b.dataset.armed) {
    delete b.dataset.armed;
    b.textContent = 'Obriši odabranu';
    act('variation', { action: 'delete', index: v.selected });
  } else {
    b.dataset.armed = '1';
    b.textContent = `Sigurno obrisati VAR ${v.selected + 1}? Dodirni opet`;
    setTimeout(() => {
      delete b.dataset.armed;
      b.textContent = 'Obriši odabranu';
    }, 3000);
  }
};

connect();
