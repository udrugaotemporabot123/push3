'use strict';
// Push 3 User Mode editor. Talks to the engine over a WebSocket; the engine owns the
// config, this page edits a copy and sends it back (debounced).

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
};

const T = {
  types: { none: 'Ništa', note: 'Nota', cc: 'CC', pc: 'Program Change', page: 'Odabir stranice', pageNext: 'Sljedeća stranica', pagePrev: 'Prethodna stranica', variation: 'Rack varijacija' },
  behaviors: { momentary: 'Momentary (dok držiš)', toggle: 'Toggle (uklj/isklj)', trigger: 'Trigger (jedan impuls)' },
  encModes: { absolute: 'Apsolutno (0–127, s povratnom info)', relative2c: 'Relativno – 2’s complement', relativeOffset: 'Relativno – offset 64' },
  anims: { none: 'Bez', 'pulse-slow': 'Pulsira sporo', pulse: 'Pulsira', 'pulse-fast': 'Pulsira brzo', 'blink-slow': 'Blinka sporo', blink: 'Blinka', 'blink-fast': 'Blinka brzo' },
  pressure: { off: 'Isključeno', polyAT: 'Poly aftertouch', channelAT: 'Channel aftertouch', cc: 'CC' },
  varActions: { recall: 'Pozovi varijaciju', store: 'Spremi u varijaciju', delete: 'Obriši varijaciju', recallLast: 'Zadnja korištena', randomize: 'Random makroi' },
};

const S = {
  ws: null,
  controls: [],
  byId: new Map(),
  palette: [],
  config: null,
  snapshot: { mode: 'live', pushConnected: false, page: 0, leds: {} },
  leds: {},
  presets: [],
  selected: new Set(),
  dirtyTimer: null,
  history: [],
  future: [],
  ctlEls: new Map(),
  monitorOn: false,
  dragSelecting: false,
  lastAnchor: null,
};

// ---------------------------------------------------------------------------------------
// Connection

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  S.ws = ws;
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    setStatus('veza prekinuta – ponovno spajanje…', 'off');
    setTimeout(connect, 1000);
  };
}

function send(msg) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg));
}

function handle(m) {
  switch (m.t) {
    case 'hello':
      S.controls = m.controls;
      S.byId = new Map(m.controls.map((c) => [c.id, c]));
      S.palette = m.palette;
      S.config = m.config;
      S.snapshot = m.snapshot;
      S.leds = { ...m.snapshot.leds };
      S.presets = m.presets || [];
      S.meta = { virtualPort: m.virtualPort, configFile: m.configFile, version: m.version, inMax: m.inMax, ports: m.ports };
      buildSurface();
      renderAll();
      (m.log || []).forEach(addEngineLog);
      if (S.monitorOn) send({ t: 'monitor', on: true });
      break;
    case 'config':
      if (S.dirtyTimer) return; // our own pending edit wins
      S.config = m.config;
      renderAll();
      break;
    case 'status':
      S.snapshot = m.snapshot;
      S.leds = { ...m.snapshot.leds };
      renderStatus();
      renderPages();
      updateAllCtls();
      renderDiscovered();
      break;
    case 'led':
      S.leds[m.id] = { color: m.color, anim: m.anim };
      updateCtl(m.id);
      break;
    case 'input':
      onHardwareInput(m);
      break;
    case 'palette':
      S.palette = m.palette;
      updateAllCtls();
      renderInspector();
      break;
    case 'presets':
      S.presets = m.presets;
      renderPresets();
      break;
    case 'midi':
      addMidiLog(m);
      break;
    case 'log':
      addEngineLog(m);
      break;
    case 'discovered':
      if (S.snapshot) {
        const list = S.snapshot.discovered || (S.snapshot.discovered = []);
        const key = m.entry.bytes.slice(0, 2).join(':');
        const ex = list.find((d) => d.key === key);
        if (ex) Object.assign(ex, m.entry);
        else list.push({ key, ...m.entry });
        renderDiscovered();
      }
      break;
    case 'live':
      S.snapshot.liveState = m.liveState;
      renderInspector();
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------
// Config editing

const curPage = () => S.config.pages[S.snapshot.page] || S.config.pages[0];

function commit(mutator) {
  S.history.push(JSON.stringify(S.config));
  if (S.history.length > 80) S.history.shift();
  S.future = [];
  mutator(S.config);
  scheduleSend();
  renderAll();
}

function scheduleSend() {
  if (S.dirtyTimer) clearTimeout(S.dirtyTimer);
  S.dirtyTimer = setTimeout(() => {
    S.dirtyTimer = null;
    send({ t: 'setConfig', config: S.config });
  }, 120);
}

function undo() {
  if (!S.history.length) return;
  S.future.push(JSON.stringify(S.config));
  S.config = JSON.parse(S.history.pop());
  scheduleSend();
  renderAll();
}

function redo() {
  if (!S.future.length) return;
  S.history.push(JSON.stringify(S.config));
  S.config = JSON.parse(S.future.pop());
  scheduleSend();
  renderAll();
}

function pageChannel(index) {
  const p = S.config.pages[index];
  if (p && p.channel) return p.channel;
  return ((S.config.settings.baseChannel - 1 + index) % 16) + 1;
}

// ---------------------------------------------------------------------------------------
// Surface

function buildSurface() {
  const surf = $('#surface');
  surf.innerHTML = '';
  S.ctlEls.clear();
  surf.append(el('div', { class: 'display', id: 'display' }));
  for (const c of S.controls) {
    if (!c.w || !c.h) continue;
    const d = el('div', { class: `ctl ${c.kind}${c.reserved ? ' reserved' : ''}${c.verify ? ' verify' : ''}`, title: tooltip(c) }, el('span', { class: 'lbl' }));
    Object.assign(d.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
    d.addEventListener('mousedown', (ev) => onCtlMouseDown(ev, c));
    d.addEventListener('mouseenter', () => onCtlEnter(c));
    surf.append(d);
    S.ctlEls.set(c.id, d);
  }
  surf.addEventListener('mousedown', (ev) => {
    if (ev.target === surf) {
      S.selected.clear();
      updateAllCtls();
      renderInspector();
    }
  });
  window.addEventListener('mouseup', () => (S.dragSelecting = false));
  fitSurface();
}

function tooltip(c) {
  const src = c.kind === 'pad' || c.kind === 'touch' ? `nota ${c.note}` : c.kind === 'encoder' ? `CC ${c.cc}, touch nota ${c.touchNote}` : c.kind === 'touchstrip' ? 'pitch bend' : `CC ${c.cc}`;
  return `${c.label} (Push šalje ${src})${c.verify ? ' – broj još nije potvrđen na hardveru' : ''}${c.reserved ? ' – rezervirano za ulaz/izlaz iz User moda' : ''}`;
}

function fitSurface() {
  const wrap = $('.surface-wrap');
  const surf = $('#surface');
  const scale = Math.min(1.25, Math.max(0.45, (wrap.clientWidth - 28) / 1200));
  surf.style.transform = `scale(${scale})`;
  surf.style.marginBottom = `${800 * (scale - 1)}px`;
  surf.style.marginRight = `${1200 * (scale - 1)}px`;
}
window.addEventListener('resize', fitSurface);

function onCtlMouseDown(ev, c) {
  ev.preventDefault();
  if (c.reserved) return;
  const add = ev.shiftKey || ev.metaKey || ev.ctrlKey;
  if (!add) S.selected.clear();
  if (add && S.selected.has(c.id)) S.selected.delete(c.id);
  else S.selected.add(c.id);
  S.dragSelecting = true;
  S.lastAnchor = c;
  updateAllCtls();
  renderInspector();
}

function onCtlEnter(c) {
  if (!S.dragSelecting || c.reserved || !S.lastAnchor || S.lastAnchor.kind !== c.kind) return;
  if (c.kind === 'pad') {
    // Rectangle from the anchor pad to this one.
    const a = S.lastAnchor;
    for (const p of S.controls) {
      if (p.kind !== 'pad') continue;
      if (p.row >= Math.min(a.row, c.row) && p.row <= Math.max(a.row, c.row) && p.col >= Math.min(a.col, c.col) && p.col <= Math.max(a.col, c.col)) S.selected.add(p.id);
    }
  } else S.selected.add(c.id);
  updateAllCtls();
  renderInspector();
}

function hex(index) {
  return `#${S.palette[index] || '000000'}`;
}

function whiteHex(index) {
  const v = Math.round(30 + (index / 127) * 225);
  return `rgb(${v},${v},${v})`;
}

// What a mapping sends, in a few characters.
function mappingSummary(c, m) {
  if (!m) return '';
  if (c.kind === 'encoder' || c.kind === 'touchstrip') {
    if (m.type === 'none') return '—';
    if (m.type === 'pitchbend') return 'PB';
    return `CC${m.number}${m.mode && m.mode !== 'absolute' ? ' rel' : ''}`;
  }
  const beh = m.behavior === 'toggle' ? ' T' : m.behavior === 'trigger' ? ' ⚡' : '';
  switch (m.type) {
    case 'note':
      return `N${m.number}${beh}`;
    case 'cc':
      return `CC${m.number}${beh}`;
    case 'pc':
      return `PC${m.number}`;
    case 'page':
      return `→ ${S.config.pages[m.page] ? S.config.pages[m.page].name : `P${m.page + 1}`}`;
    case 'pageNext':
      return 'Str. ▶';
    case 'pagePrev':
      return '◀ Str.';
    case 'variation':
      return `Var ${m.index + 1}${m.action !== 'recall' ? ` ${m.action}` : ''}`;
    default:
      return '—';
  }
}

// Two lines: physical name (or the user's label) and what it sends. Pads show only the mapping.
function ctlText(c, m) {
  const sum = mappingSummary(c, m);
  if (c.kind === 'pad') return m && m.label ? `${m.label}\n${sum}` : sum === '—' ? '' : sum;
  return `${(m && m.label) || c.short || c.label}\n${sum}`;
}

function updateCtl(id) {
  const c = S.byId.get(id);
  const d = S.ctlEls.get(id);
  if (!c || !d || !S.config) return;
  const pageBtn = S.config.settings.pageButtons === 'upper' && id.startsWith('upper.');
  const m = curPage().controls[id];
  const led = S.leds[id];
  let bg = '';
  if (led && (c.kind === 'pad' || c.kind === 'button')) {
    bg = c.led === 'white' ? (led.color ? whiteHex(led.color) : '') : led.color ? hex(led.color) : '';
  }
  d.style.background = bg;
  d.classList.toggle('dark-text', !!bg && luminance(bg) > 0.55);
  d.classList.toggle('sel', S.selected.has(id));
  d.classList.toggle('none', !c.reserved && !pageBtn && m && m.type === 'none');
  const text = c.reserved ? 'User\n(ulaz/izlaz)' : pageBtn ? `${c.short}\n${(S.config.pages[Number(id.split('.')[1]) - 1] || {}).name || '—'}` : ctlText(c, m);
  const lbl = d.firstChild;
  lbl.textContent = '';
  text.split('\n').forEach((line, i) => lbl.append(i ? el('span', { class: 'sub' }, line) : line));
}

function luminance(color) {
  let r, g, b;
  if (color.startsWith('#')) [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  else [r, g, b] = color.match(/\d+/g).map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function updateAllCtls() {
  for (const id of S.ctlEls.keys()) updateCtl(id);
}

function onHardwareInput(m) {
  const d = S.ctlEls.get(m.id);
  if (d) {
    d.classList.add('hit');
    clearTimeout(d._hit);
    d._hit = setTimeout(() => d.classList.remove('hit'), m.kind === 'press' || m.kind === 'touch' ? 400 : 150);
  }
  if ($('#followHw').checked && (m.kind === 'press' || m.kind === 'turn' || m.kind === 'touch' || m.kind === 'strip')) {
    const c = S.byId.get(m.id);
    if (c && !c.reserved && !(S.selected.size === 1 && S.selected.has(m.id))) {
      if (S.config.settings.pageButtons === 'upper' && m.id.startsWith('upper.')) return;
      S.selected = new Set([m.id]);
      updateAllCtls();
      renderInspector();
    }
  }
}

// ---------------------------------------------------------------------------------------
// Status, pages

function setStatus(text, cls) {
  const s = $('#status');
  s.textContent = text;
  s.className = `chip ${cls || ''}`;
}

function renderStatus() {
  const sn = S.snapshot;
  if (!sn.pushConnected) setStatus('Push 3 nije pronađen', 'off');
  else if (sn.mode === 'user') setStatus(`USER MODE · ${curPage().name}`, 'user');
  else setStatus('Spreman · Live mode', 'live');
  const disp = $('#display');
  if (disp) {
    disp.innerHTML = '';
    disp.append(
      el('div', {}, el('b', {}, curPage().name), el('br'), `kanal ${pageChannel(S.snapshot.page)} · `, sn.mode === 'user' ? 'User Mode aktivan' : 'pritisni User na Pushu', el('br'), el('span', { class: 'small' }, `virtualni port: ${S.meta ? S.meta.virtualPort : ''}`)),
    );
  }
}

function renderPages() {
  const nav = $('#pages');
  nav.innerHTML = '';
  S.config.pages.forEach((p, i) => {
    nav.append(
      el(
        'div',
        { class: `tab${i === S.snapshot.page ? ' active' : ''}`, onclick: () => selectPage(i), ondblclick: () => renamePage(i), title: 'Dvoklik = preimenuj' },
        el('span', { class: 'dot', style: `background:${hex(p.color)}` }),
        p.name,
        el('span', { class: 'ch' }, `ch ${pageChannel(i)}`),
      ),
    );
  });
  if (S.config.pages.length < 16) {
    nav.append(el('button', { onclick: () => send({ t: 'addPage' }), title: 'Nova stranica sa zadanim mapiranjem' }, '+ Nova'));
    nav.append(el('button', { onclick: () => send({ t: 'addPage', duplicate: S.snapshot.page }), title: 'Kopija trenutne stranice' }, 'Dupliciraj'));
  }
}

function selectPage(i) {
  S.snapshot.page = i;
  send({ t: 'setPage', page: i });
  renderAll();
}

function renamePage(i) {
  const name = prompt('Ime stranice', S.config.pages[i].name);
  if (name) commit((c) => (c.pages[i].name = name.slice(0, 24)));
}

// ---------------------------------------------------------------------------------------
// Inspector

function selectedControls() {
  return [...S.selected].map((id) => S.byId.get(id)).filter(Boolean);
}

function common(list, key) {
  const vals = list.map((m) => (typeof key === 'function' ? key(m) : m[key]));
  return vals.every((v) => JSON.stringify(v) === JSON.stringify(vals[0])) ? vals[0] : undefined;
}

function setAll(key, value, filter) {
  commit((cfg) => {
    const page = cfg.pages[S.snapshot.page];
    for (const id of S.selected) {
      const m = page.controls[id];
      if (!m || (filter && !filter(m, S.byId.get(id)))) continue;
      if (typeof key === 'function') key(m, S.byId.get(id));
      else m[key] = value;
    }
  });
}

function field(label, control, help) {
  return el('div', { class: 'field' }, el('label', { title: help || '' }, label), control);
}

function selectEl(options, value, onchange) {
  const s = el('select', { onchange: (e) => onchange(e.target.value) });
  if (value === undefined) s.append(el('option', { value: '', selected: true, disabled: true }, '— različito —'));
  for (const [v, label] of Object.entries(options)) s.append(el('option', { value: v, selected: String(value) === v }, label));
  return s;
}

function numEl(value, min, max, onchange, step = 1) {
  return el('input', { type: 'number', min, max, step, value: value === undefined ? '' : value, placeholder: value === undefined ? '—' : '', onchange: (e) => e.target.value !== '' && onchange(Number(e.target.value)) });
}

function textEl(value, onchange, placeholder = '') {
  return el('input', { type: 'text', value: value === undefined ? '' : value, placeholder: value === undefined ? '— različito —' : placeholder, onchange: (e) => onchange(e.target.value) });
}

function colorField(label, key, list, isWhite) {
  const v = common(list, key);
  const wrap = el('div', {});
  const sw = el('span', { class: 'swatch', style: `background:${v === undefined ? 'repeating-linear-gradient(45deg,#333,#333 4px,#222 4px,#222 8px)' : isWhite ? whiteHex(v) : hex(v)}`, title: v === undefined ? 'različito' : `boja ${v}` });
  const pop = el('div', { class: 'pal-pop hidden' });
  sw.addEventListener('click', () => {
    pop.classList.toggle('hidden');
    if (!pop.childNodes.length) pop.append(isWhite ? whitePicker(v, (i) => setAll(key, i)) : palettePicker(v, (i) => setAll(key, i)));
  });
  wrap.append(el('div', { class: 'inline' }, sw, el('span', { class: 'muted small' }, v === undefined ? 'različito' : isWhite ? `svjetlina ${v}` : `#${v}`)), pop);
  return field(label, wrap);
}

function palettePicker(cur, pick) {
  const grid = el('div', { class: 'palette' });
  for (let i = 0; i < 128; i++) grid.append(el('span', { class: `swatch${i === cur ? ' cur' : ''}`, style: `background:${hex(i)}`, title: `${i}`, onclick: () => pick(i) }));
  return grid;
}

function whitePicker(cur, pick) {
  const grid = el('div', { class: 'palette' });
  for (let i = 0; i < 128; i += 8) grid.append(el('span', { class: `swatch${i === cur ? ' cur' : ''}`, style: `background:${whiteHex(i)}`, title: `${i}`, onclick: () => pick(i) }));
  grid.append(el('span', { class: `swatch${cur === 127 ? ' cur' : ''}`, style: `background:${whiteHex(127)}`, title: '127', onclick: () => pick(127) }));
  return grid;
}

function renderInspector() {
  const box = $('#inspector');
  box.innerHTML = '';
  if (!S.config) return;
  const ctls = selectedControls();
  if (!ctls.length) return renderPageInspector(box);
  const kinds = new Set(ctls.map((c) => (c.kind === 'pad' || c.kind === 'button' || c.kind === 'touch' ? 'btn' : c.kind)));
  const title = ctls.length === 1 ? ctls[0].label : `${ctls.length} kontrola`;
  const srcInfo = ctls.length === 1 ? tooltip(ctls[0]).replace(/^[^(]*\(/, '(') : '';
  box.append(el('h3', {}, title), el('div', { class: 'sub' }, srcInfo || `stranica ${curPage().name}`));
  if (kinds.size > 1) {
    box.append(el('p', { class: 'muted' }, 'Odabrane su različite vrste kontrola. Odaberi samo padove/gumbe ili samo enkodere.'));
    return;
  }
  const page = curPage();
  const maps = ctls.map((c) => page.controls[c.id]).filter(Boolean);
  if (S.config.settings.pageButtons === 'upper' && ctls.some((c) => c.id.startsWith('upper.'))) {
    box.append(el('div', { class: 'note' }, 'Gornji red gumba trenutno bira stranice 1–8. To možeš isključiti u Postavkama (Gumbi za stranice → Ništa).'));
    return;
  }
  const kind = [...kinds][0];
  if (kind === 'btn') renderButtonInspector(box, ctls, maps);
  else if (kind === 'encoder') renderEncoderInspector(box, ctls, maps);
  else if (kind === 'touchstrip') renderStripInspector(box, maps);
}

function channelSelect(maps) {
  const v = common(maps, 'channel');
  const opts = { 0: `Stranica (${pageChannel(S.snapshot.page)})` };
  for (let i = 1; i <= 16; i++) opts[i] = `${i}`;
  return field('Kanal', selectEl(opts, v, (x) => setAll('channel', Number(x))), 'Kanal na koji ide poruka. "Stranica" = kanal ove stranice.');
}

function renderButtonInspector(box, ctls, maps) {
  const type = common(maps, 'type');
  const isPad = ctls.every((c) => c.kind === 'pad');
  const isWhite = ctls.every((c) => c.led === 'white');
  const noLed = ctls.every((c) => c.led === 'none');
  box.append(field('Funkcija', selectEl(T.types, type, (v) => setAll((m) => setType(m, v)))));

  if (type === 'note' || type === 'cc' || type === 'pc') {
    const numRow = el('div', { class: 'inline' }, numEl(common(maps, 'number'), 0, 127, (v) => setAll('number', v)));
    if (ctls.length > 1) numRow.append(el('button', { onclick: () => numberSequence(), title: 'Dodijeli brojeve redom (padovi od dolje lijevo)' }, 'Redom…'));
    box.append(field(type === 'note' ? 'Nota' : type === 'cc' ? 'CC broj' : 'Program', numRow));
    box.append(channelSelect(maps));
    if (type !== 'pc') {
      box.append(field('Ponašanje', selectEl(T.behaviors, common(maps, 'behavior'), (v) => setAll('behavior', v))));
      if (isPad) box.append(field('Velocity', selectEl({ dynamic: 'Dinamički (jačina udarca)', fixed: 'Fiksno (On vrijednost)' }, common(maps, 'velocity'), (v) => setAll('velocity', v))));
      box.append(field('On / Off', el('div', { class: 'inline' }, numEl(common(maps, 'onValue'), 0, 127, (v) => setAll('onValue', v)), numEl(common(maps, 'offValue'), 0, 127, (v) => setAll('offValue', v))), 'Vrijednost koja se šalje za uključeno / isključeno'));
      box.append(field('Grupa', textEl(common(maps, 'group'), (v) => setAll('group', v.trim()), 'npr. scene'), 'Kontrole s istim imenom grupe isključuju jedna drugu (radio gumbi).'));
    }
    if (isPad) {
      const pr = common(maps, 'pressure');
      box.append(field('Pritisak', selectEl(T.pressure, pr, (v) => setAll('pressure', v)), 'Što šalje pritisak prsta nakon udarca (poly aftertouch s Pusha).'));
      if (pr === 'cc') box.append(field('Pritisak CC', numEl(common(maps, 'pressureCc'), 0, 127, (v) => setAll('pressureCc', v))));
    }
  } else if (type === 'page') {
    const opts = {};
    S.config.pages.forEach((p, i) => (opts[i] = p.name));
    box.append(field('Stranica', selectEl(opts, common(maps, 'page'), (v) => setAll('page', Number(v)))));
  } else if (type === 'variation') {
    renderVariationFields(box, maps);
  }

  if (!noLed && type !== undefined) {
    box.append(el('div', { class: 'sep' }));
    box.append(colorField(type === 'variation' ? 'Boja aktivne' : 'Boja ON', 'colorOn', maps, isWhite));
    box.append(colorField(type === 'variation' ? 'Boja postojeće' : 'Boja OFF', 'colorOff', maps, isWhite));
    box.append(field('Animacija', selectEl(T.anims, common(maps, 'anim'), (v) => setAll('anim', v)), 'Kad je uključeno. Treba MIDI clock (motor ga sam šalje ako ga Live ne šalje).'));
  }
  box.append(el('div', { class: 'sep' }));
  box.append(field('Oznaka', textEl(common(maps, 'label'), (v) => setAll('label', v), 'npr. Reverb'), 'Samo za prikaz u editoru'));
  renderBatchTools(box, ctls);
}

function setType(m, v) {
  m.type = v;
  if (v === 'variation') {
    m.target = m.target || { track: 'selected', device: 'first' };
    if (m.index === undefined) m.index = 0;
    m.action = m.action || 'recall';
  }
  if (v === 'page' && m.page === undefined) m.page = 0;
}

function renderVariationFields(box, maps) {
  const tr = common(maps, (m) => m.target && m.target.track);
  const dv = common(maps, (m) => m.target && m.target.device);
  const setTrack = (v) => setAll((m) => (m.target = { ...m.target, track: v.trim() || 'selected' }));
  const setDevice = (v) => setAll((m) => (m.target = { ...m.target, device: v.trim() || 'first' }));
  box.append(field('Track', textEl(tr, setTrack, 'selected'), 'selected = trenutno odabrani track, ili točno ime tracka'));
  box.append(field('Rack', textEl(dv, setDevice, 'first'), 'first = prvi rack na tracku, ili točno ime racka'));
  box.append(field('Varijacija', numEl(common(maps, (m) => m.index + 1), 1, 128, (v) => setAll('index', v - 1))));
  box.append(field('Radnja', selectEl(T.varActions, common(maps, 'action'), (v) => setAll('action', v))));
  const ls = S.snapshot.liveState && S.snapshot.liveState.variations;
  const key = tr && dv ? `${tr}|${dv}` : null;
  const st = key && ls && ls[key];
  box.append(
    el('div', { class: st && st.ok ? 'note' : 'warn' }, st && st.ok ? `Povezano: ${st.name || 'rack'} · ${st.count} varijacija · aktivna ${st.selected + 1}` : S.meta && S.meta.inMax ? 'Rack nije pronađen (provjeri ime tracka/racka).' : 'Varijacije rade samo kad motor radi unutar Max for Live devicea.'),
  );
  box.append(el('p', { class: 'muted small' }, 'Shift + pad = spremi trenutno stanje u tu varijaciju.'));
}

function renderBatchTools(box, ctls) {
  const pads = ctls.filter((c) => c.kind === 'pad');
  if (pads.length < 2) return;
  box.append(el('div', { class: 'sep' }), el('b', {}, 'Brze radnje'));
  box.append(
    el(
      'div',
      { class: 'btnrow' },
      el('button', { onclick: () => assignVariations(pads), title: 'Odabrani padovi = varijacije 1..n (čitanje s lijeva na desno, odozgo)' }, 'Pretvori u varijacije'),
      el('button', { onclick: () => setAll((m) => Object.assign(m, { type: 'note', behavior: 'momentary', velocity: 'dynamic' })) }, 'Svirački padovi'),
      el('button', { onclick: () => setAll((m) => Object.assign(m, { type: 'cc', behavior: 'toggle', velocity: 'fixed', onValue: 127, offValue: 0 })) }, 'Toggle CC'),
      el('button', { onclick: () => setAll((m) => (m.type = 'none')) }, 'Isključi'),
    ),
  );
}

function readingOrder(a, b) {
  return b.row - a.row || a.col - b.col;
}

function assignVariations(pads) {
  const track = prompt('Track (selected = odabrani track, ili ime tracka)', 'selected');
  if (track === null) return;
  const device = prompt('Rack (first = prvi rack, ili ime racka)', 'first');
  if (device === null) return;
  const ordered = pads.slice().sort(readingOrder);
  commit((cfg) => {
    const page = cfg.pages[S.snapshot.page];
    ordered.forEach((c, i) => {
      Object.assign(page.controls[c.id], { type: 'variation', target: { track: track.trim() || 'selected', device: device.trim() || 'first' }, index: i, action: 'recall', colorOn: 3, colorOff: dimColor(page.color) });
    });
  });
}

function dimColor(i) {
  return i >= 4 && i < 64 ? i - ((i - 4) % 4) + 2 : 1;
}

function numberSequence() {
  const start = Number(prompt('Početni broj', '36'));
  if (!Number.isFinite(start)) return;
  const ctls = selectedControls().sort((a, b) => (a.kind === 'pad' && b.kind === 'pad' ? a.row - b.row || a.col - b.col : S.controls.indexOf(a) - S.controls.indexOf(b)));
  commit((cfg) => {
    const page = cfg.pages[S.snapshot.page];
    ctls.forEach((c, i) => (page.controls[c.id].number = Math.min(127, start + i)));
  });
}

function renderEncoderInspector(box, ctls, maps) {
  const type = common(maps, 'type');
  box.append(field('Funkcija', selectEl({ none: 'Ništa', cc: 'CC' }, type, (v) => setAll('type', v))));
  if (type === 'cc') {
    const numRow = el('div', { class: 'inline' }, numEl(common(maps, 'number'), 0, 127, (v) => setAll('number', v)));
    if (ctls.length > 1) numRow.append(el('button', { onclick: () => numberSequence() }, 'Redom…'));
    box.append(field('CC broj', numRow));
    box.append(channelSelect(maps));
    const mode = common(maps, 'mode');
    box.append(field('Način', selectEl(T.encModes, mode, (v) => setAll('mode', v))));
    if (mode === 'absolute') {
      box.append(field('Osjetljivost', numEl(common(maps, 'sensitivity'), 0.05, 8, (v) => setAll('sensitivity', v), 0.05), '1 = jedan korak enkodera je jedan korak vrijednosti. 0.5 = finije.'));
      box.append(field('Raspon', el('div', { class: 'inline' }, numEl(common(maps, 'min'), 0, 127, (v) => setAll('min', v)), numEl(common(maps, 'max'), 0, 127, (v) => setAll('max', v)))));
      box.append(el('p', { class: 'muted small' }, 'U Liveu mapiraj kao Absolute. Uključi Remote na izlazu porta da enkoder prati promjene iz Livea (nema skokova).'));
    } else {
      box.append(el('p', { class: 'muted small' }, 'U Liveu nakon mapiranja odaberi isti relativni Mapping Mode u statusnoj traci.'));
    }
  }
  if (type !== 'none') {
    box.append(el('div', { class: 'sep' }));
    const touch = common(maps, 'touch');
    box.append(field('Dodir', selectEl({ none: 'Ništa', note: 'Šalji notu' }, touch, (v) => setAll('touch', v)), 'Dodir vrha enkodera'));
    if (touch === 'note') box.append(field('Nota dodira', numEl(common(maps, 'touchNumber'), 0, 127, (v) => setAll('touchNumber', v))));
  }
  box.append(el('div', { class: 'sep' }), field('Oznaka', textEl(common(maps, 'label'), (v) => setAll('label', v), 'npr. Cutoff')));
}

function renderStripInspector(box, maps) {
  const type = common(maps, 'type');
  box.append(field('Funkcija', selectEl({ none: 'Ništa', pitchbend: 'Pitch bend', cc: 'CC' }, type, (v) => setAll('type', v))));
  if (type === 'cc') box.append(field('CC broj', numEl(common(maps, 'number'), 0, 127, (v) => setAll('number', v))));
  if (type !== 'none') box.append(channelSelect(maps));
  box.append(el('p', { class: 'muted small' }, 'Fader način (bez vraćanja na sredinu) uključuješ u Postavkama.'));
}

function renderPageInspector(box) {
  const i = S.snapshot.page;
  const p = curPage();
  box.append(el('h3', {}, p.name), el('div', { class: 'sub' }, 'Postavke stranice · odaberi kontrolu za uređivanje'));
  box.append(field('Ime', textEl(p.name, (v) => commit((c) => (c.pages[i].name = v.slice(0, 24) || c.pages[i].name)))));
  const chOpts = { 0: `Automatski (${((S.config.settings.baseChannel - 1 + i) % 16) + 1})` };
  for (let k = 1; k <= 16; k++) chOpts[k] = `${k}`;
  box.append(field('MIDI kanal', selectEl(chOpts, String(p.channel), (v) => commit((c) => (c.pages[i].channel = Number(v)))), 'Sve kontrole ove stranice šalju na ovaj kanal (osim ako kontrola ima svoj).'));
  const wrap = el('div', {});
  wrap.append(palettePicker(p.color, (k) => commit((c) => (c.pages[i].color = k))));
  box.append(field('Boja', wrap));
  box.append(
    el(
      'div',
      { class: 'btnrow' },
      i > 0 ? el('button', { onclick: () => movePage(i, -1) }, '◀ Pomakni') : null,
      i < S.config.pages.length - 1 ? el('button', { onclick: () => movePage(i, 1) }, 'Pomakni ▶') : null,
      S.config.pages.length > 1 ? el('button', { class: 'danger', onclick: () => deletePage(i) }, 'Obriši stranicu') : null,
    ),
  );
  box.append(el('div', { class: 'sep' }));
  box.append(
    el(
      'div',
      { class: 'note' },
      el('b', {}, 'Kako radi'),
      el('br'),
      'Pritisni User na Pushu. Gornji red gumba bira stranicu. Svaka kontrola šalje poruku koju ovdje odabereš na virtualni port ',
      el('code', {}, S.meta ? S.meta.virtualPort : ''),
      ', a ti je u Liveu MIDI-mapiraš (Cmd+M). LED-ice prate stanje iz Livea preko istog porta.',
    ),
  );
}

function movePage(i, d) {
  commit((c) => {
    const [p] = c.pages.splice(i, 1);
    c.pages.splice(i + d, 0, p);
  });
  selectPage(i + d);
}

function deletePage(i) {
  if (!confirm(`Obrisati stranicu "${S.config.pages[i].name}"?`)) return;
  commit((c) => c.pages.splice(i, 1));
  selectPage(Math.max(0, i - 1));
}

// ---------------------------------------------------------------------------------------
// Settings, presets, monitor

function renderSettings() {
  const b = $('#settingsBody');
  b.innerHTML = '';
  const s = S.config.settings;
  const set = (k, v) => commit((c) => (c.settings[k] = v));
  const chOpts = {};
  for (let i = 1; i <= 16; i++) chOpts[i] = `${i}`;
  const left = el(
    'div',
    {},
    el('h4', {}, 'Općenito'),
    field('Početni kanal', selectEl(chOpts, String(s.baseChannel), (v) => set('baseChannel', Number(v))), 'Stranica 1 šalje na ovaj kanal, stranica 2 na sljedeći, itd. (osim ako stranica ima svoj kanal)'),
    field('MPE u User modu', selectEl({ true: 'Isključi (čiste note + poly AT)', false: 'Ostavi kako je' }, String(s.disableMpeInUserMode), (v) => set('disableMpeInUserMode', v === 'true')), 'Kad uđeš u User mode, Push se prebaci na poly aftertouch; kad izađeš, vrati se postavka koju je imao.'),
    field('Touch strip', selectEl({ false: 'Pitch bend (vraća se)', true: 'Fader (ostaje gdje pustiš)' }, String(s.stripFader), (v) => set('stripFader', v === 'true'))),
    field('Gumbi za stranice', selectEl({ upper: 'Gornji red (1–8)', none: 'Ništa (mapiraj sam)' }, s.pageButtons, (v) => set('pageButtons', v))),
    field('Nemapirane LED', selectEl({ off: 'Ugašene', dim: 'Lagano upaljene' }, s.unmappedLeds, (v) => set('unmappedLeds', v))),
    field('Interni clock', selectEl({ true: 'Da (animacije rade i bez Live clocka)', false: 'Ne' }, String(s.internalClock), (v) => set('internalClock', v === 'true'))),
    el('div', { class: 'btnrow' }, el('button', { class: 'danger', onclick: () => confirm('Vratiti sve na tvorničke postavke?') && send({ t: 'resetConfig' }) }, 'Vrati na zadano')),
    el('p', { class: 'muted small' }, `Konfiguracija: ${S.meta ? S.meta.configFile : ''}`),
  );
  const vp = S.meta ? S.meta.virtualPort : 'Push3 UM';
  const right = el(
    'div',
    {},
    el('h4', {}, 'Postavljanje u Liveu (jednom)'),
    el(
      'ol',
      { class: 'small' },
      el('li', {}, 'Live → Settings → Link, Tempo & MIDI.'),
      el('li', {}, el('b', {}, 'Push 3 User Port'), ' (ulaz i izlaz): isključi Track i Remote. Ovaj device ga koristi umjesto Livea.'),
      el('li', {}, el('b', {}, `${vp}`), ' ulaz: uključi Track (za sviranje padovima) i Remote (za mapiranje).'),
      el('li', {}, el('b', {}, `${vp}`), ' izlaz: uključi Remote (povratna informacija za LED-ice i enkodere).'),
      el('li', {}, 'Za sviranje: na MIDI tracku postavi MIDI From = ', el('code', {}, vp), ' i kanal stranice.'),
    ),
    el('p', { class: 'muted small' }, S.meta && S.meta.ports ? `MIDI portovi: ${S.meta.ports.inputs.join(', ')}` : ''),
  );
  b.append(el('div', { class: 'settings-grid' }, left, right));
}

function renderPresets() {
  const menu = $('#presetsMenu');
  menu.innerHTML = '';
  const name = el('input', { type: 'text', placeholder: 'ime preseta' });
  menu.append(el('div', { class: 'row' }, name, el('button', { class: 'primary', onclick: () => name.value.trim() && send({ t: 'savePreset', name: name.value.trim() }) }, 'Spremi')));
  if (!S.presets.length) menu.append(el('p', { class: 'muted small' }, 'Nema spremljenih preseta.'));
  for (const p of S.presets) {
    menu.append(
      el(
        'div',
        { class: 'row' },
        el('span', {}, p),
        el('button', { onclick: () => confirm(`Učitati "${p}"? Trenutne postavke će biti zamijenjene.`) && send({ t: 'loadPreset', name: p }) }, 'Učitaj'),
        el('button', { class: 'danger', onclick: () => confirm(`Obrisati "${p}"?`) && send({ t: 'deletePreset', name: p }) }, '×'),
      ),
    );
  }
}

const DIR_LABEL = { 'push-in': 'Push →', 'push-out': '→ Push', 'host-in': 'Live →', 'host-out': '→ Live' };
function addMidiLog(m) {
  const isPush = m.dir.startsWith('push');
  if ((isPush && !$('#monPush').checked) || (!isPush && !$('#monHost').checked)) return;
  const log = $('#monLog');
  const line = `${new Date().toISOString().slice(17, 23)}  ${DIR_LABEL[m.dir].padEnd(7)} ${m.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(26)} ${describe(m.bytes)}\n`;
  log.append(el('span', { class: m.dir.endsWith('in') ? 'in' : '' }, line));
  while (log.childNodes.length > 400) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

function describe(b) {
  const t = b[0] & 0xf0;
  const ch = (b[0] & 0x0f) + 1;
  if (b[0] === 0xf0) return 'sysex';
  if (b[0] >= 0xf8) return 'realtime';
  return { 0x80: `note off ${b[1]} ch${ch}`, 0x90: `note ${b[1]} vel ${b[2]} ch${ch}`, 0xa0: `poly AT ${b[1]}=${b[2]} ch${ch}`, 0xb0: `CC ${b[1]}=${b[2]} ch${ch}`, 0xc0: `PC ${b[1]} ch${ch}`, 0xd0: `chan AT ${b[1]} ch${ch}`, 0xe0: `pitch bend ch${ch}` }[t] || '';
}

function addEngineLog(m) {
  const log = $('#engineLog');
  log.append(`${m.level}: ${m.msg}\n`);
  while (log.childNodes.length > 200) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

function renderDiscovered() {
  const ul = $('#discovered');
  if (!ul) return;
  ul.innerHTML = '';
  for (const d of (S.snapshot && S.snapshot.discovered) || []) ul.append(el('li', {}, `${d.bytes.map((x) => x.toString(16).padStart(2, '0')).join(' ')} — ${describe(d.bytes)} (${d.count}×)`));
}

// ---------------------------------------------------------------------------------------

function renderAll() {
  if (!S.config) return;
  renderStatus();
  renderPages();
  updateAllCtls();
  renderInspector();
  if (!$('#settings').classList.contains('hidden')) renderSettings();
  renderPresets();
}

function wireUi() {
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#presetsBtn').onclick = () => $('#presetsMenu').classList.toggle('hidden');
  $('#settingsBtn').onclick = () => {
    $('#settings').classList.toggle('hidden');
    renderSettings();
  };
  $('#settingsClose').onclick = () => $('#settings').classList.add('hidden');
  $('#monitorBtn').onclick = () => {
    const hidden = $('#monitor').classList.toggle('hidden');
    S.monitorOn = !hidden;
    send({ t: 'monitor', on: S.monitorOn });
  };
  $('#monClose').onclick = () => {
    $('#monitor').classList.add('hidden');
    S.monitorOn = false;
    send({ t: 'monitor', on: false });
  };
  $('#monClear').onclick = () => {
    $('#monLog').innerHTML = '';
    send({ t: 'clearDiscovered' });
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (e.key === 'Escape') {
      S.selected.clear();
      updateAllCtls();
      renderInspector();
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      S.selected = new Set(S.controls.filter((c) => c.kind === 'pad').map((c) => c.id));
      updateAllCtls();
      renderInspector();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) $('#presetsMenu').classList.add('hidden');
  });
}

wireUi();
connect();
