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
  types: { none: 'Ništa', note: 'Nota', cc: 'CC', pc: 'Program Change', page: 'Odabir stranice', pageHold: 'Drži za stranicu', pageNext: 'Sljedeća stranica', pagePrev: 'Prethodna stranica', variation: 'Rack varijacija', live: 'Live (bez mapiranja)', addon: 'Add-on', panic: 'Panic (all notes off)' },
  liveActions: { mute: 'Mute tracka', solo: 'Solo tracka', arm: 'Arm tracka', select: 'Odaberi track', scene: 'Pokreni scenu', play: 'Play/Stop', stop: 'Stop', record: 'Session Record', metronome: 'Metronom', overdub: 'Arrangement Overdub', tap: 'Tap Tempo', undo: 'Undo', redo: 'Redo', capture: 'Capture MIDI', param: 'Parametar devicea', clip: 'Clip slot (pokreni / snimi)', clipDelete: 'Obriši clip', stopTrack: 'Stop tracka', trackPrev: '◀ Prethodni track', trackNext: 'Sljedeći track ▶', scenePrev: '▲ Prethodna scena', sceneNext: 'Sljedeća scena ▼', devicePrev: '◀ Prethodni device', deviceNext: 'Sljedeći device ▶' },
  paramModes: { toggle: 'Toggle (min/max)', momentary: 'Momentary (max dok držiš)', trigger: 'Trigger (impuls)' },
  liveTargets: { volume: 'Volumen tracka', pan: 'Pan tracka', send: 'Send tracka', macro: 'Makro racka', deviceParam: 'Parametar odabranog devicea', named: 'Parametar devicea po imenu', tempo: 'Tempo' },
  behaviors: { momentary: 'Momentary (dok držiš)', toggle: 'Toggle (uklj/isklj)', trigger: 'Trigger (jedan impuls)' },
  encModes: { absolute: 'Apsolutno (0–127, s povratnom info)', relative2c: 'Relativno – 2’s complement', relativeOffset: 'Relativno – offset 64', steps: 'Koraci (gore/dolje kao gumbi)' },
  anims: { none: 'Bez', 'pulse-slow': 'Pulsira sporo', pulse: 'Pulsira', 'pulse-fast': 'Pulsira brzo', 'blink-slow': 'Blinka sporo', blink: 'Blinka', 'blink-fast': 'Blinka brzo' },
  pressure: { off: 'Isključeno', polyAT: 'Poly aftertouch', channelAT: 'Channel aftertouch', cc: 'CC', live: 'Live parametar' },
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
  layer: '', // '' = normal mapping, 's' = shift layer
};

// The mapping being edited/shown for the current layer. With create=true a missing shift
// mapping is created (type none) so it can be filled in.
function layerMap(base, ctl, create = false) {
  if (!base || S.layer !== 's') return base;
  if (base.shift) return base.shift;
  const sh = shiftDefaults(ctl);
  if (create) base.shift = sh;
  return sh;
}

function shiftDefaults(ctl) {
  if (ctl.kind === 'encoder') return { type: 'none', number: ctl.cc, mode: 'absolute', sensitivity: 0.5, min: 0, max: 127, touch: 'none', touchNumber: ctl.touchNote };
  const rgb = ctl.led === 'rgb';
  return {
    type: 'none',
    number: ctl.kind === 'pad' || ctl.kind === 'touch' ? ctl.note : ctl.cc,
    behavior: 'momentary',
    velocity: ctl.kind === 'pad' ? 'dynamic' : 'fixed',
    onValue: 127,
    offValue: 0,
    colorOn: rgb ? 45 : 127,
    colorOff: rgb ? 1 : 16,
    anim: 'none',
    pressure: 'off',
    pressureCc: 1,
  };
}

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
      S.meta = { virtualPort: m.virtualPort, configFile: m.configFile, version: m.version, inMax: m.inMax, ports: m.ports, addons: m.addons || [] };
      buildSurface();
      renderAll();
      $('.brand').title = `verzija ${m.version}`;
      $('.brand').innerHTML = `Push 3 <b>User Mode</b> <span class="muted small">v${m.version}</span>`;
      (m.log || []).forEach(addEngineLog);
      if (S.monitorOn) send({ t: 'monitor', on: true });
      send({ t: 'display', on: true });
      break;
    case 'display':
      renderDisplayPreview(m);
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
    case 'health':
      S.health = m.health;
      renderHealth();
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
  surf.append(el('div', { class: 'display', id: 'display' }, el('img', { id: 'displayImg', alt: '' }), el('div', { id: 'displayInfo', class: 'small muted' })));
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
    if (m.type === 'live') return `Live ${(T.liveTargets[m.live && m.live.target] || '').split(' ')[0]}`;
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
    case 'live':
      return `⚡${(T.liveActions[m.live && m.live.action] || 'Live').replace(' tracka', '')}${m.live && m.live.track && m.live.track !== 'selected' && ['mute', 'solo', 'arm', 'select'].includes(m.live.action) ? ` ${m.live.track}` : ''}`;
    case 'addon': {
      const a = ((S.meta && S.meta.addons) || []).find((x) => m.addon && x.id === m.addon.id);
      const act = a && a.actions[m.addon.action];
      return `◆ ${act ? act.label : 'Add-on'}`;
    }
    case 'panic':
      return 'PANIC';
    case 'pageHold':
      return `⇥ ${S.config.pages[m.page] ? S.config.pages[m.page].name : `P${m.page + 1}`}`;
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
  const m = layerMap(curPage().controls[id], c);
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
  renderDisplayInfo();
}

const DISPLAY_STATE = {
  closed: 'pregled (Push ekran drži Live)',
  opening: 'preuzimam ekran…',
  active: 'prikazuje se na Pushu',
  busy: 'Live drži ekran – samo pregled',
  unavailable: 'USB nije dostupan – samo pregled',
  error: 'greška – samo pregled',
};

function renderDisplayInfo() {
  const info = $('#displayInfo');
  if (!info || !S.config) return;
  const t = S.displayTransport || { state: 'closed' };
  const mode = S.config.settings.display === 'takeover' ? DISPLAY_STATE[t.state] || t.state : 'samo pregled (preuzimanje ekrana isključeno u Postavkama)';
  info.textContent = `Ekran: ${mode}${t.detail && S.config.settings.display === 'takeover' ? ` · ${t.detail}` : ''}`;
}

function renderDisplayPreview(m) {
  const img = $('#displayImg');
  if (img) img.src = `data:image/png;base64,${m.png}`;
  S.displayTransport = m.transport;
  renderDisplayInfo();
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
      const m = layerMap(page.controls[id], S.byId.get(id), true);
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
  if (S.config.settings.shiftLayer && ctls.some((c) => c.id === 'shift')) {
    box.append(el('div', { class: 'note' }, 'Shift je modifikator: dok ga držiš, kontrole koje imaju Shift sloj rade drugo. To možeš isključiti u Postavkama (Shift sloj).'));
    return;
  }
  box.append(layerSwitch());
  const maps = ctls.map((c) => layerMap(page.controls[c.id], c)).filter(Boolean);
  if (S.config.settings.pageButtons === 'upper' && ctls.some((c) => c.id.startsWith('upper.'))) {
    box.append(el('div', { class: 'note' }, 'Gornji red gumba trenutno bira stranice 1–8. To možeš isključiti u Postavkama (Gumbi za stranice → Ništa).'));
    return;
  }
  const kind = [...kinds][0];
  if (kind === 'btn') renderButtonInspector(box, ctls, maps);
  else if (kind === 'encoder') renderEncoderInspector(box, ctls, maps);
  else if (kind === 'touchstrip') renderStripInspector(box, maps);
}

function layerSwitch() {
  if (!S.config.settings.shiftLayer) return el('span');
  const btn = (layer, label) => el('button', { class: S.layer === layer ? 'primary' : '', onclick: () => ((S.layer = layer), renderAll()) }, label);
  return el('div', { class: 'btnrow' }, btn('', 'Normalno'), btn('s', 'Shift sloj'), el('span', { class: 'muted small', style: 'align-self:center' }, S.layer === 's' ? 'radi dok držiš Shift' : ''));
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
      if (isPad && common(maps, 'velocity') === 'dynamic') box.append(field('Krivulja', selectEl({ soft: 'Meko (lakše do glasnog)', linear: 'Linearno', hard: 'Tvrdo' }, common(maps, 'curve') || 'linear', (v) => setAll('curve', v))));
      box.append(field('On / Off', el('div', { class: 'inline' }, numEl(common(maps, 'onValue'), 0, 127, (v) => setAll('onValue', v)), numEl(common(maps, 'offValue'), 0, 127, (v) => setAll('offValue', v))), 'Vrijednost koja se šalje za uključeno / isključeno'));
      box.append(field('Grupa', textEl(common(maps, 'group'), (v) => setAll('group', v.trim()), 'npr. scene'), 'Kontrole s istim imenom grupe isključuju jedna drugu (radio gumbi).'));
      if (type !== 'pc') renderExtraFields(box, maps);
    }
    if (isPad) {
      const pr = common(maps, 'pressure');
      box.append(field('Pritisak', selectEl(T.pressure, pr, (v) => setAll('pressure', v)), 'Što šalje pritisak prsta nakon udarca (poly aftertouch s Pusha).'));
      if (pr === 'cc') box.append(field('Pritisak CC', numEl(common(maps, 'pressureCc'), 0, 127, (v) => setAll('pressureCc', v))));
      if (pr === 'live') {
        renderLiveTargetFields(box, maps, 'pressureLive');
        box.append(el('p', { class: 'muted small' }, 'Kad pustiš pad, parametar se vraća na minimum.'));
      }
    }
  } else if (type === 'page' || type === 'pageHold') {
    const opts = {};
    S.config.pages.forEach((p, i) => (opts[i] = p.name));
    box.append(field('Stranica', selectEl(opts, common(maps, 'page'), (v) => setAll('page', Number(v)))));
  } else if (type === 'variation') {
    renderVariationFields(box, maps);
  } else if (type === 'live') {
    renderLiveButtonFields(box, maps);
  } else if (type === 'addon') {
    renderAddonFields(box, maps);
  }

  if (!noLed && type !== undefined && type !== 'addon') {
    box.append(el('div', { class: 'sep' }));
    box.append(colorField(type === 'variation' ? 'Boja aktivne' : 'Boja ON', 'colorOn', maps, isWhite));
    box.append(colorField(type === 'variation' ? 'Boja postojeće' : 'Boja OFF', 'colorOff', maps, isWhite));
    box.append(field('Animacija', selectEl(T.anims, common(maps, 'anim'), (v) => setAll('anim', v)), 'Kad je uključeno. Treba MIDI clock (motor ga sam šalje ako ga Live ne šalje).'));
  }
  box.append(el('div', { class: 'sep' }));
  box.append(field('Oznaka', textEl(common(maps, 'label'), (v) => setAll('label', v), 'npr. Reverb'), 'Samo za prikaz u editoru'));
  renderBatchTools(box, ctls);
}

// Extra messages sent together with the main one (up to four).
function renderExtraFields(box, maps) {
  const extra = common(maps, (m) => m.extra || []);
  if (extra === undefined) {
    box.append(field('Dodatne poruke', el('span', { class: 'muted small' }, 'različito')));
    return;
  }
  const wrap = el('div', {});
  const update = (fn) =>
    setAll((m) => {
      m.extra = JSON.parse(JSON.stringify(m.extra || []));
      fn(m.extra);
      if (!m.extra.length) delete m.extra;
    });
  extra.forEach((x, i) => {
    const chOpts = { 0: 'kanal str.' };
    for (let c = 1; c <= 16; c++) chOpts[c] = `ch ${c}`;
    wrap.append(
      el(
        'div',
        { class: 'inline', style: 'margin-bottom:4px' },
        selectEl({ cc: 'CC', note: 'Nota' }, x.type, (v) => update((a) => (a[i].type = v))),
        numEl(x.number, 0, 127, (v) => update((a) => (a[i].number = v))),
        selectEl(chOpts, String(x.channel || 0), (v) => update((a) => (a[i].channel = Number(v)))),
        el('button', { onclick: () => update((a) => a.splice(i, 1)) }, '×'),
      ),
    );
  });
  if (extra.length < 4) wrap.append(el('button', { onclick: () => update((a) => a.push({ type: 'cc', number: 0, channel: 0 })) }, '+ dodaj poruku'));
  box.append(field('Dodatne poruke', wrap, 'Šalju se zajedno s glavnom porukom (iste vrijednosti)'));
}

function setType(m, v) {
  m.type = v;
  if (v === 'variation') {
    m.target = m.target || { track: 'selected', device: 'first' };
    if (m.index === undefined) m.index = 0;
    m.action = m.action || 'recall';
  }
  if ((v === 'page' || v === 'pageHold') && m.page === undefined) m.page = 0;
  if (v === 'live' && !m.live) m.live = { action: 'mute', track: 'selected', scene: 0, trackColor: true };
}

// Same key the engine uses for a Live-aware mapping (see engine/src/live.js).
function liveKeyOf(m) {
  const l = m && m.live;
  if (!l) return null;
  let spec = null;
  if (l.target) {
    spec = l.target === 'tempo' ? { t: 'param', target: 'tempo' } : { t: 'param', target: l.target, track: l.track };
    if (l.target === 'send' || l.target === 'deviceParam') spec.index = l.index;
    if (l.target === 'macro') Object.assign(spec, { device: l.device, index: l.index });
    if (l.target === 'named') Object.assign(spec, { device: l.device, param: l.param });
  } else if (['mute', 'solo', 'arm'].includes(l.action)) spec = { t: 'trackProp', track: l.track, prop: l.action };
  else if (l.action === 'select') spec = { t: 'trackSelect', track: l.track };
  else if (l.action === 'play') spec = { t: 'song', prop: 'is_playing' };
  else if (l.action === 'record') spec = { t: 'song', prop: 'session_record' };
  else if (l.action === 'metronome') spec = { t: 'song', prop: 'metronome' };
  else if (l.action === 'overdub') spec = { t: 'song', prop: 'arrangement_overdub' };
  else if (l.action === 'clip' || l.action === 'clipDelete') spec = { t: 'slot', track: l.track, scene: l.scene };
  else if (l.action === 'param') spec = { t: 'param', target: 'named', track: l.track, device: l.device, param: l.param };
  if (!spec) return null;
  return JSON.stringify(Object.keys(spec).sort().reduce((o, k) => ((o[k] = spec[k]), o), {}));
}

function liveStatus(m) {
  const key = liveKeyOf(m);
  if (!key) return null;
  const v = S.snapshot.liveState && S.snapshot.liveState.values && S.snapshot.liveState.values[key];
  if (!S.meta || !S.meta.inMax) return el('div', { class: 'warn' }, 'Live funkcije rade samo kad motor radi unutar Max for Live devicea.');
  if (!v) return el('div', { class: 'muted small' }, 'Čekam odgovor Livea…');
  if (!v.ok) return el('div', { class: 'warn' }, 'Cilj nije pronađen u Liveu (provjeri ime/broj tracka ili racka).');
  return el('div', { class: 'note' }, `Povezano: ${v.name || ''}${v.display ? ` · ${v.display}` : ''}${v.value !== undefined && !v.display ? ` · ${v.value ? 'ON' : 'OFF'}` : ''}`);
}

function setLive(key, value) {
  setAll((m) => (m.live = { ...(m.live || {}), [key]: value }));
}

function renderLiveButtonFields(box, maps) {
  const action = common(maps, (m) => m.live && m.live.action);
  box.append(field('Radnja', selectEl(T.liveActions, action, (v) => setLive('action', v))));
  if (action === 'param') {
    box.append(field('Track', textEl(common(maps, (m) => m.live && m.live.track), (v) => setLive('track', v.trim() || 'selected'), 'selected'), 'selected = odabrani track, broj ili ime'));
    box.append(field('Device', textEl(common(maps, (m) => m.live && m.live.device), (v) => setLive('device', v.trim() || 'selected'), 'selected'), 'Ime devicea (traži i unutar rackova), "first" ili "selected"'));
    box.append(field('Parametar', textEl(common(maps, (m) => m.live && m.live.param), (v) => setLive('param', v.trim() || '1'), 'npr. Device On'), 'Ime parametra (npr. "Device On", "Record") ili broj (1 = prvi)'));
    box.append(field('Način', selectEl(T.paramModes, common(maps, (m) => m.live && m.live.mode), (v) => setLive('mode', v))));
  }
  if (['clip', 'clipDelete', 'stopTrack'].includes(action)) {
    box.append(field('Track', textEl(common(maps, (m) => m.live && m.live.track), (v) => setLive('track', v.trim() || 'selected'), 'selected'), 'selected = odabrani track, broj ili ime'));
    if (action !== 'stopTrack') box.append(field('Scena (red)', numEl(common(maps, (m) => m.live && m.live.scene), 0, 999, (v) => setLive('scene', v)), '0 = odabrana scena, inače broj scene'));
    if (action === 'clip') box.append(el('p', { class: 'muted small' }, 'Prazan slot na armanom tracku = snimanje. LED: boja clipa, pulsira dok svira, crveno blinka dok snima.'));
  }
  if (['mute', 'solo', 'arm', 'select'].includes(action)) {
    box.append(field('Track', textEl(common(maps, (m) => m.live && m.live.track), (v) => setLive('track', v.trim() || 'selected'), 'selected'), 'selected = odabrani track, broj (1, 2, …) ili točno ime tracka'));
    box.append(field('Boja tracka', selectEl({ true: 'Da (LED u boji tracka)', false: 'Ne (Boja ON)' }, String(common(maps, (m) => m.live && m.live.trackColor)), (v) => setLive('trackColor', v === 'true'))));
  }
  if (action === 'scene') box.append(field('Scena', numEl(common(maps, (m) => m.live && m.live.scene), 0, 999, (v) => setLive('scene', v)), '0 = odabrana scena, inače broj scene'));
  if (maps.length === 1) {
    const st = liveStatus(maps[0]);
    if (st) box.append(st);
  }
}

function renderAddonFields(box, maps) {
  const addons = (S.meta && S.meta.addons) || [];
  if (!addons.length) {
    box.append(el('p', { class: 'muted' }, 'Nema instaliranih add-ona.'));
    return;
  }
  const opts = {};
  for (const a of addons) for (const [k, act] of Object.entries(a.actions || {})) opts[`${a.id}:${k}`] = `${a.name}: ${act.label}`;
  const cur = common(maps, (m) => (m.addon ? `${m.addon.id}:${m.addon.action}` : ''));
  box.append(
    field('Radnja', selectEl(opts, cur, (v) => {
      const [id, action] = v.split(':');
      const def = addons.find((a) => a.id === id).actions[action];
      setAll((m) => {
        const params = {};
        for (const [f, spec] of Object.entries(def.fields || {})) params[f] = (m.addon && m.addon.params && m.addon.params[f]) || spec.default || '';
        m.addon = { id, action, params };
      });
    })),
  );
  if (!cur) return;
  const [id, action] = cur.split(':');
  const a = addons.find((x) => x.id === id);
  const def = a && a.actions[action];
  if (!def) return;
  for (const [f, spec] of Object.entries(def.fields || {})) {
    box.append(field(spec.label || f, textEl(common(maps, (m) => m.addon && m.addon.params && m.addon.params[f]), (v) => setAll((m) => (m.addon.params = { ...m.addon.params, [f]: v.trim() || spec.default || '' })), spec.default || ''), spec.help || ''));
  }
  box.append(el('p', { class: 'muted small' }, a.description || ''));
  if (S.config.settings.addons && S.config.settings.addons[id] === false) box.append(el('div', { class: 'warn' }, 'Ovaj add-on je isključen u Postavkama.'));
}

function renderLiveEncoderFields(box, maps) {
  const target = common(maps, (m) => m.live && m.live.target);
  box.append(field('Cilj', selectEl(T.liveTargets, target, (v) => setLive('target', v))));
  if (target !== 'tempo') box.append(field('Track', textEl(common(maps, (m) => m.live && m.live.track), (v) => setLive('track', v.trim() || 'selected'), 'selected'), 'selected = odabrani track, broj ili ime'));
  if (target === 'macro') box.append(field('Rack', textEl(common(maps, (m) => m.live && m.live.device), (v) => setLive('device', v.trim() || 'first'), 'first'), 'first = prvi rack, ili ime racka'));
  if (target === 'named') {
    box.append(field('Device', textEl(common(maps, (m) => m.live && m.live.device), (v) => setLive('device', v.trim() || 'selected'), 'selected'), 'Ime devicea (traži i unutar rackova), "first" ili "selected"'));
    box.append(field('Parametar', textEl(common(maps, (m) => m.live && m.live.param), (v) => setLive('param', v.trim() || '1'), 'npr. Dry/Wet'), 'Ime parametra ili broj (1 = prvi)'));
  }
  if (['send', 'macro', 'deviceParam'].includes(target)) {
    const lbl = target === 'send' ? 'Send broj' : target === 'macro' ? 'Makro broj' : 'Parametar broj';
    const row = el('div', { class: 'inline' }, numEl(common(maps, (m) => m.live && m.live.index), 1, 128, (v) => setLive('index', v)));
    if (maps.length > 1) row.append(el('button', { onclick: () => liveIndexSequence() }, 'Redom 1…n'));
    box.append(field(lbl, row));
  }
  box.append(field('Osjetljivost', numEl(common(maps, 'sensitivity'), 0.05, 8, (v) => setAll('sensitivity', v), 0.05)));
  if (maps.length === 1) {
    const st = liveStatus(maps[0]);
    if (st) box.append(st);
  }
  box.append(el('p', { class: 'muted small' }, 'Ime i vrijednost parametra prikazuju se na ekranu.'));
}

function liveIndexSequence() {
  const ctls = selectedControls().sort((a, b) => S.controls.indexOf(a) - S.controls.indexOf(b));
  commit((cfg) => {
    const page = cfg.pages[S.snapshot.page];
    ctls.forEach((c, i) => {
      const m = layerMap(page.controls[c.id], c, true);
      m.live = { ...(m.live || {}), index: i + 1 };
    });
  });
}

function renderVariationFields(box, maps) {
  const tr = common(maps, (m) => m.target && m.target.track);
  const dv = common(maps, (m) => m.target && m.target.device);
  const setTrack = (v) => setAll((m) => (m.target = { ...m.target, track: v.trim() || 'selected' }));
  const setDevice = (v) => setAll((m) => (m.target = { ...m.target, device: v.trim() || 'first' }));
  box.append(field('Track', textEl(tr, setTrack, 'selected'), 'selected = trenutno odabrani track, ili točno ime tracka'));
  box.append(field('Rack', textEl(dv, setDevice, 'first'), 'first = prvi rack, #2 = drugi rack na tracku, ili točno ime racka'));
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
  box.append(field('Funkcija', selectEl({ none: 'Ništa', cc: 'CC', live: 'Live (bez mapiranja)' }, type, (v) => setAll((m) => {
    m.type = v;
    if (v === 'live' && !m.live) m.live = { target: 'volume', track: 'selected', device: 'first', index: 1 };
  }))));
  if (type === 'live') {
    renderLiveEncoderFields(box, maps);
    box.append(el('div', { class: 'sep' }), field('Oznaka', textEl(common(maps, 'label'), (v) => setAll('label', v), 'npr. Cutoff')));
    return;
  }
  if (type === 'cc') {
    const numRow = el('div', { class: 'inline' }, numEl(common(maps, 'number'), 0, 127, (v) => setAll('number', v)));
    if (ctls.length > 1) numRow.append(el('button', { onclick: () => numberSequence() }, 'Redom…'));
    box.append(field('CC broj', numRow));
    box.append(channelSelect(maps));
    const mode = common(maps, 'mode');
    box.append(field('Način', selectEl(T.encModes, mode, (v) => setAll('mode', v))));
    if (mode === 'steps') {
      box.append(field('Šalje', selectEl({ cc: 'CC (127 pa 0)', note: 'Notu (on/off)' }, common(maps, 'stepType'), (v) => setAll('stepType', v))));
      box.append(field('Gore / dolje', el('div', { class: 'inline' }, numEl(common(maps, 'upNumber'), 0, 127, (v) => setAll('upNumber', v)), numEl(common(maps, 'downNumber'), 0, 127, (v) => setAll('downNumber', v))), 'Broj poruke za okret udesno / ulijevo'));
      box.append(field('Korak', numEl(common(maps, 'stepSize'), 1, 32, (v) => setAll('stepSize', v)), 'Koliko pomaka enkodera za jedan korak (veće = sporije)'));
      box.append(el('p', { class: 'muted small' }, 'U Liveu mapiraj gore/dolje kao gumbe (npr. sljedeći/prethodni preset, scena, clip).'));
    } else if (mode === 'absolute') {
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

// Live parameter target fields stored under m[key] (touch strip: 'live', pad pressure: 'pressureLive').
function renderLiveTargetFields(box, maps, key) {
  const get = (f) => common(maps, (m) => m[key] && m[key][f]);
  const set = (f, v) => setAll((m) => (m[key] = { target: 'volume', track: 'selected', device: 'first', index: 1, param: '1', ...(m[key] || {}), [f]: v }));
  const target = get('target') || 'volume';
  box.append(field('Live cilj', selectEl(T.liveTargets, target, (v) => set('target', v))));
  if (target !== 'tempo') box.append(field('Track', textEl(get('track'), (v) => set('track', v.trim() || 'selected'), 'selected')));
  if (target === 'macro' || target === 'named') box.append(field(target === 'macro' ? 'Rack' : 'Device', textEl(get('device'), (v) => set('device', v.trim() || 'first'), 'first')));
  if (['send', 'macro', 'deviceParam'].includes(target)) box.append(field('Broj', numEl(get('index'), 1, 128, (v) => set('index', v))));
  if (target === 'named') box.append(field('Parametar', textEl(get('param'), (v) => set('param', v.trim() || '1'), 'npr. Frequency')));
}

function renderStripInspector(box, maps) {
  const type = common(maps, 'type');
  box.append(field('Funkcija', selectEl({ none: 'Ništa', pitchbend: 'Pitch bend', cc: 'CC', live: 'Live parametar' }, type, (v) => setAll('type', v))));
  if (type === 'live') {
    renderLiveTargetFields(box, maps, 'live');
    box.append(el('p', { class: 'muted small' }, 'Za filter sweep i slično uključi u Postavkama Touch strip = Fader (ostaje gdje pustiš).'));
    return;
  }
  if (type === 'cc') box.append(field('CC broj', numEl(common(maps, 'number'), 0, 127, (v) => setAll('number', v))));
  if (type !== 'none') box.append(channelSelect(maps));
  box.append(el('p', { class: 'muted small' }, 'Fader način (bez vraćanja na sredinu) uključuješ u Postavkama.'));
}

function renderPageInspector(box) {
  const i = S.snapshot.page;
  const p = curPage();
  box.append(el('h3', {}, p.name), el('div', { class: 'sub' }, 'Postavke stranice · odaberi kontrolu za uređivanje'));
  box.append(layerSwitch());
  box.append(field('Ime', textEl(p.name, (v) => commit((c) => (c.pages[i].name = v.slice(0, 24) || c.pages[i].name)))));
  const chOpts = { 0: `Automatski (${((S.config.settings.baseChannel - 1 + i) % 16) + 1})` };
  for (let k = 1; k <= 16; k++) chOpts[k] = `${k}`;
  box.append(field('Ekran', selectEl({ controls: 'Kontrole (enkoderi + gumbi)', big: 'Veliko (ime stranice, zadnja radnja, tempo)' }, p.display || 'controls', (v) => commit((c) => (c.pages[i].display = v))), 'Što Push ekran prikazuje na ovoj stranici'));
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
  box.append(el('div', { class: 'sep' }), el('b', {}, 'Predlošci'));
  for (const [key, t] of Object.entries(TEMPLATES)) {
    box.append(el('div', { class: 'btnrow' }, el('button', { onclick: () => applyTemplate(key), title: t.help }, t.name)), el('p', { class: 'muted small', style: 'margin:-4px 0 6px' }, t.help));
  }
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

const NAV_BUTTONS = () => {
  const N = (action) => ({ type: 'live', colorOn: 127, colorOff: 16, live: { action } });
  return { left: N('trackPrev'), right: N('trackNext'), up: N('scenePrev'), down: N('sceneNext'), pageLeft: N('devicePrev'), pageRight: N('deviceNext') };
};

// One-click page templates built from Live-aware mappings (no MIDI mapping needed).
const TEMPLATES = {
  mixer: {
    name: 'Mixer (8 trackova)',
    help: 'Enkoderi = volumen trackova 1–8, donji red = mute (boja tracka), padovi gore: select / solo / arm, scene gumbi = scene 1–8.',
    apply(ctl) {
      const r = {};
      for (let i = 1; i <= 8; i++) {
        const t = String(i);
        r[`enc.${i}`] = { type: 'live', sensitivity: 0.5, live: { target: 'volume', track: t } };
        r[`lower.${i}`] = { type: 'live', colorOn: 5, colorOff: 1, live: { action: 'mute', track: t, trackColor: true } };
        r[`scene.${i}`] = { type: 'live', colorOn: 21, colorOff: 23, live: { action: 'scene', scene: i } };
        r[`pad.7.${i - 1}`] = { type: 'live', colorOn: 3, colorOff: 1, live: { action: 'select', track: t, trackColor: true } };
        r[`pad.6.${i - 1}`] = { type: 'live', colorOn: 45, colorOff: 47, live: { action: 'solo', track: t, trackColor: false } };
        r[`pad.5.${i - 1}`] = { type: 'live', colorOn: 5, colorOff: 7, live: { action: 'arm', track: t, trackColor: false } };
      }
      return r;
    },
  },
  selected: {
    name: 'Odabrani track (makroi + varijacije)',
    help: 'Enkoderi 1–8 = makroi prvog racka na odabranom tracku, donji red = varijacije 1–8 tog racka, Volume enkoder = volumen tracka.',
    apply() {
      const r = { 'enc.volume': { type: 'live', sensitivity: 0.5, live: { target: 'volume', track: 'selected' } } };
      for (let i = 1; i <= 8; i++) {
        r[`enc.${i}`] = { type: 'live', sensitivity: 0.5, live: { target: 'macro', track: 'selected', device: 'first', index: i } };
        r[`lower.${i}`] = { type: 'variation', target: { track: 'selected', device: 'first' }, index: i - 1, action: 'recall', colorOn: 3, colorOff: 30 };
      }
      return r;
    },
  },
  clips: {
    name: 'Clip grid 8×8',
    help: 'Padovi = clip slotovi (stupac = track 1–8, red = scena 1–8, gornji red = scena 1); Shift + pad briše clip; scene gumbi = scene; donji red = stop tracka.',
    apply() {
      const r = {};
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const scene = 8 - row;
          r[`pad.${row}.${col}`] = {
            type: 'live',
            colorOn: 21,
            colorOff: 0,
            live: { action: 'clip', track: String(col + 1), scene },
            shift: { type: 'live', colorOn: 5, colorOff: 7, live: { action: 'clipDelete', track: String(col + 1), scene } },
          };
        }
      }
      for (let i = 1; i <= 8; i++) {
        r[`scene.${i}`] = { type: 'live', colorOn: 21, colorOff: 23, live: { action: 'scene', scene: i } };
        r[`lower.${i}`] = { type: 'live', colorOn: 5, colorOff: 7, live: { action: 'stopTrack', track: String(i) } };
      }
      return r;
    },
  },
  device: {
    name: 'Odabrani device (8 parametara)',
    help: 'Enkoderi 1–8 = parametri 1–8 odabranog devicea (imena i vrijednosti na ekranu). Strelice ◀ ▶ = prethodni/sljedeći track, ▲ ▼ = scena, Page ◀ ▶ = prethodni/sljedeći device.',
    apply() {
      const r = {};
      for (let i = 1; i <= 8; i++) r[`enc.${i}`] = { type: 'live', sensitivity: 0.5, live: { target: 'deviceParam', track: 'selected', index: i } };
      Object.assign(r, NAV_BUTTONS());
      return r;
    },
  },
  sends: {
    name: 'Sendovi odabranog tracka',
    help: 'Enkoderi 1–8 = send A–H odabranog tracka, Volume enkoder = volumen tracka; strelice za navigaciju.',
    apply() {
      const r = { 'enc.volume': { type: 'live', sensitivity: 0.5, live: { target: 'volume', track: 'selected' } } };
      for (let i = 1; i <= 8; i++) r[`enc.${i}`] = { type: 'live', sensitivity: 0.5, live: { target: 'send', track: 'selected', index: i } };
      Object.assign(r, NAV_BUTTONS());
      return r;
    },
  },
  variations: {
    name: 'Varijacije (8 rackova × 8)',
    help: 'Red padova = rack #1…#8 na tracku (gornji red = prvi rack), stupac = varijacija 1–8. Svijetli = postoji, bijelo = aktivna. Shift + pad = spremi novu varijaciju.',
    ask: [{ key: 'track', label: 'Track (selected = odabrani, ili ime/broj)', default: 'selected' }],
    apply(a) {
      const colors = [29, 45, 9, 57, 13, 49, 33, 5];
      const r = {};
      for (let row = 0; row < 8; row++) {
        const rackNo = 8 - row;
        for (let col = 0; col < 8; col++) {
          r[`pad.${row}.${col}`] = { type: 'variation', target: { track: a.track, device: `#${rackNo}` }, index: col, action: 'recall', colorOn: 3, colorOff: colors[rackNo - 1] };
        }
      }
      return r;
    },
  },
  sampler: {
    name: 'Sampler (live sampling → padovi)',
    help: 'Capture = snimi pa stavi na sljedeći prazni pad, New = zadnji clip na odabrani pad, Duplicate = zadnji clip na sljedeći pad. Treba Drum Rack s praznim Simplerima.',
    ask: [
      { key: 'source', label: 'Track koji snima (npr. mic in - sampling)', default: 'selected' },
      { key: 'target', label: 'Track s Drum Rackom', default: 'selected' },
    ],
    apply(a) {
      const S2 = (action) => ({ type: 'addon', addon: { id: 'sampler', action, params: { source: a.source, target: a.target, rack: 'first', autoArm: 'yes' } } });
      return { capture: S2('sampleToPad'), new: S2('lastToSelected'), duplicate: S2('lastToPad') };
    },
  },
  seq8: {
    name: 'Step sekvencer (8 traka × 8 koraka)',
    help: 'Red = traka (donji red = nota 36/C1, iznad 37…), stupac = korak 1–8. Udarac u pad uključi korak (jačina = velocity), Shift + pad briše traku. Scene 1 = Play/Stop, Scene 8 = obriši. Treba Sync na izlazu Push3 UM i MIDI track s Drum Rackom.',
    apply() {
      const r = {};
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) r[`pad.${row}.${col}`] = { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'A', lane: String(row + 1), step: String(col + 1), note: String(36 + row) } } };
      }
      r['scene.1'] = { type: 'addon', addon: { id: 'stepseq', action: 'play', params: { seq: 'A' } } };
      r['scene.8'] = { type: 'addon', addon: { id: 'stepseq', action: 'clear', params: { seq: 'A' } } };
      return r;
    },
  },
  seq16: {
    name: 'Step sekvencer (4 trake × 16 koraka)',
    help: 'Svaka traka zauzima dva reda (gore koraci 1–8, dolje 9–16); trake od dna: note 36, 37, 38, 39. Scene 1 = Play/Stop, Scene 8 = obriši.',
    apply() {
      const r = {};
      for (let lane = 0; lane < 4; lane++) {
        for (let half = 0; half < 2; half++) {
          const row = lane * 2 + (1 - half);
          for (let col = 0; col < 8; col++) r[`pad.${row}.${col}`] = { type: 'addon', addon: { id: 'stepseq', action: 'step', params: { seq: 'B', lane: String(lane + 1), step: String(half * 8 + col + 1), note: String(36 + lane) } } };
        }
      }
      r['scene.1'] = { type: 'addon', addon: { id: 'stepseq', action: 'play', params: { seq: 'B' } } };
      r['scene.8'] = { type: 'addon', addon: { id: 'stepseq', action: 'clear', params: { seq: 'B' } } };
      return r;
    },
  },
  seqDrum: {
    name: 'Drum sekvencer 16 padova + 32 koraka (+ Sampler)',
    help: 'Donji lijevi 4×4 = drum padovi (note 36–51): udarac svira i odabire traku. Gornja 4 reda = 32 koraka odabrane trake (Shift + korak briše traku). Scene 1 = Play/Stop, Scene 2 = snimanje udaraca (svira dok Live svira, upisuje u najbliži korak), Scene 8 = obriši. Shift + drum pad = ciljni pad za Sampler, Capture = snimi u njega.',
    ask: [
      { key: 'source', label: 'Track koji snima (npr. mic in - sampling)', default: 'selected' },
      { key: 'target', label: 'Track s Drum Rackom', default: 'selected' },
      { key: 'swing', label: 'Swing % (50 = ravno, 66 = shuffle)', default: '50' },
    ],
    apply(a) {
      const r = {};
      const Q = (action, params) => ({ type: 'addon', addon: { id: 'stepseq', action, params: { seq: 'D', ...params } } });
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const lane = row * 4 + col + 1;
          r[`pad.${row}.${col}`] = Object.assign(Q('hit', { lane: String(lane), note: String(35 + lane) }), {
            shift: { type: 'addon', addon: { id: 'sampler', action: 'targetPad', params: { target: a.target, rack: 'first', note: String(35 + lane) } } },
          });
        }
      }
      for (let row = 4; row < 8; row++) {
        for (let col = 0; col < 8; col++) r[`pad.${row}.${col}`] = Q('step', { lane: 'selected', step: String((7 - row) * 8 + col + 1) });
      }
      r['scene.1'] = Q('play', { swing: a.swing });
      r['scene.2'] = Q('rec', {});
      r['scene.8'] = Q('clear', {});
      r.capture = { type: 'addon', addon: { id: 'sampler', action: 'sampleToSelected', params: { source: a.source, target: a.target, rack: 'first', autoArm: 'yes' } } };
      return r;
    },
  },
  samplerPads: {
    name: 'Sampler + Drum Rack 4×4',
    help: 'Donji lijevi 4×4 padovi sviraju Drum Rack (note 36–51); Shift + pad = odaberi taj pad kao cilj; Capture = snimi u odabrani pad; New = zadnji clip u odabrani pad.',
    ask: [
      { key: 'source', label: 'Track koji snima (npr. mic in - sampling)', default: 'selected' },
      { key: 'target', label: 'Track s Drum Rackom', default: 'selected' },
    ],
    apply(a) {
      const r = {};
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const note = 36 + row * 4 + col;
          r[`pad.${row}.${col}`] = {
            type: 'note',
            number: note,
            behavior: 'momentary',
            velocity: 'dynamic',
            colorOn: 3,
            colorOff: 51,
            shift: { type: 'addon', addon: { id: 'sampler', action: 'targetPad', params: { target: a.target, rack: 'first', note: String(note) } } },
          };
        }
      }
      const S2 = (action) => ({ type: 'addon', addon: { id: 'sampler', action, params: { source: a.source, target: a.target, rack: 'first', autoArm: 'yes' } } });
      r.capture = S2('sampleToSelected');
      r.new = S2('lastToSelected');
      return r;
    },
  },
  looper: {
    name: 'Looper (8 trackova)',
    help: 'Stupac = track 1–8: gornji pad snima sljedeći loop (drugi pritisak zatvara loop), ispod Play/Stop, Poništi zadnji, Arm. Brojeve trackova možeš zamijeniti imenima.',
    apply() {
      const r = {};
      const A = (action, track) => ({ type: 'addon', addon: { id: 'looper', action, params: { track, autoArm: 'yes' } } });
      for (let c = 0; c < 8; c++) {
        const t = String(c + 1);
        r[`pad.7.${c}`] = A('recNext', t);
        r[`pad.6.${c}`] = A('playStop', t);
        r[`pad.5.${c}`] = A('undoLast', t);
        r[`pad.4.${c}`] = A('arm', t);
      }
      return r;
    },
  },
  transport: {
    name: 'Transport',
    help: 'Play, Record (session), Metronom, Tap, Undo, Capture, Automate = overdub, Stop Clip = stop, Duplicate = redo.',
    apply() {
      const L = (action, colorOn, colorOff) => ({ type: 'live', colorOn, colorOff, live: { action } });
      return {
        play: L('play', 21, 23),
        record: L('record', 5, 7),
        metronome: L('metronome', 127, 16),
        tap: L('tap', 127, 16),
        undo: L('undo', 127, 16),
        duplicate: L('redo', 127, 16),
        capture: L('capture', 127, 16),
        automate: L('overdub', 5, 7),
        stop: L('stop', 5, 1),
      };
    },
  },
};

function applyTemplate(key) {
  const t = TEMPLATES[key];
  if (!confirm(`Primijeniti predložak "${t.name}" na stranicu "${curPage().name}"? Prepisat će te kontrole.`)) return;
  const answers = {};
  for (const q of t.ask || []) {
    const v = prompt(q.label, q.default);
    if (v === null) return;
    answers[q.key] = v.trim() || q.default;
  }
  commit((cfg) => {
    const page = cfg.pages[S.snapshot.page];
    for (const [id, m] of Object.entries(t.apply(answers))) page.controls[id] = { ...page.controls[id], ...m, shift: m.shift || (page.controls[id] && page.controls[id].shift) };
  });
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
    field('Shift + enkoder', selectEl({ true: '10× finije', false: 'Normalno' }, String(s.shiftFine), (v) => set('shiftFine', v === 'true')), 'Vrijedi za enkodere koji nemaju vlastiti Shift sloj.'),
    field('Shift sloj', selectEl({ true: 'Uključen (Shift = modifikator)', false: 'Isključen (Shift je običan gumb)' }, String(s.shiftLayer), (v) => set('shiftLayer', v === 'true')), 'Dok držiš Shift, kontrole s Shift slojem šalju drugu poruku.'),
    field('Push ekran', selectEl({ editor: 'Samo pregled u editoru', takeover: 'Preuzmi ekran u User modu (eksperimentalno)' }, s.display, (v) => set('display', v)), 'Pokušava crtati na Push 3 ekran dok si u User modu. Ako ga Live drži, ostaje pregled ovdje.'),
    field('Interni clock', selectEl({ true: 'Da (animacije rade i bez Live clocka)', false: 'Ne' }, String(s.internalClock), (v) => set('internalClock', v === 'true'))),
    el('h4', {}, 'Add-oni'),
    ...((S.meta && S.meta.addons) || []).map((a) =>
      field(a.name, selectEl({ true: 'Uključen', false: 'Isključen' }, String(!(s.addons && s.addons[a.id] === false)), (v) => commit((c) => (c.settings.addons = { ...(c.settings.addons || {}), [a.id]: v === 'true' }))), a.description),
    ),
    el('div', { class: 'btnrow' }, el('button', { class: 'danger', onclick: () => confirm('Vratiti sve na tvorničke postavke?') && send({ t: 'resetConfig' }) }, 'Vrati na zadano')),
    el('p', { class: 'muted small' }, `Konfiguracija: ${S.meta ? S.meta.configFile : ''}`),
  );
  const vp = S.meta ? S.meta.virtualPort : 'Push3 UM';
  const right = el(
    'div',
    {},
    el('h4', {}, 'Provjera'),
    el('ul', { id: 'healthBox', class: 'small', style: 'list-style:none;padding-left:0' }),
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
  renderHealth();
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(S.config, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `push3-user-mode-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

function importConfig() {
  const input = el('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const cfg = JSON.parse(await f.text());
      if (!cfg || !Array.isArray(cfg.pages)) throw new Error('nije Push3 User Mode konfiguracija');
      if (!confirm(`Učitati "${f.name}"? Trenutne postavke će biti zamijenjene (možeš poništiti s Ctrl+Z).`)) return;
      commit((c) => {
        c.version = cfg.version;
        c.settings = cfg.settings;
        c.pages = cfg.pages;
      });
    } catch (e) {
      alert(`Ne mogu učitati datoteku: ${e.message}`);
    }
  });
  input.click();
}

// Copy/paste of mappings (with their shift layers) between controls and pages.
function copySelection() {
  const ctls = selectedControls();
  if (!ctls.length) return;
  const page = curPage();
  S.clipboard = sortForPaste(ctls).map((c) => ({ kind: c.kind, m: JSON.parse(JSON.stringify(page.controls[c.id])) }));
  setStatusFlash(`Kopirano: ${ctls.length}`);
}

function pasteSelection() {
  if (!S.clipboard || !S.clipboard.length) return;
  const targets = sortForPaste(selectedControls());
  if (!targets.length) return;
  commit((cfg) => {
    const page = cfg.pages[S.snapshot.page];
    targets.forEach((c, i) => {
      const src = S.clipboard.length === 1 ? S.clipboard[0] : S.clipboard[i];
      if (!src) return;
      const sameFamily = (a, b) => a === b || (['pad', 'button', 'touch'].includes(a) && ['pad', 'button', 'touch'].includes(b));
      if (!sameFamily(src.kind, c.kind)) return;
      page.controls[c.id] = JSON.parse(JSON.stringify(src.m));
    });
  });
  setStatusFlash(`Zalijepljeno: ${targets.length}`);
}

function sortForPaste(ctls) {
  return ctls.slice().sort((a, b) => (a.kind === 'pad' && b.kind === 'pad' ? b.row - a.row || a.col - b.col : S.controls.indexOf(a) - S.controls.indexOf(b)));
}

function setStatusFlash(text) {
  const s = $('#status');
  const prev = [s.textContent, s.className];
  s.textContent = text;
  setTimeout(() => {
    if (s.textContent === text) [s.textContent, s.className] = prev;
  }, 1200);
}

// Setup check: what works and what still needs a switch in Live's preferences.
function renderHealth() {
  const box = $('#healthBox');
  if (!box || !S.health) return;
  const h = S.health;
  const ago = (t) => (t ? (h.now - t) / 1000 : Infinity);
  const rows = [
    [h.pushConnected, 'Push 3 User Port pronađen', 'Spoji Push 3 USB-om; u Liveu za Push 3 User Port isključi Track i Remote.'],
    [h.virtualPort, 'Virtualni port Push3 UM postoji', 'Restartaj device (gumb Restart).'],
    [h.inMax && h.bridgeReady, 'Live API most radi (varijacije, Live funkcije)', h.inMax ? 'Pričekaj par sekundi ili restartaj device.' : 'Radi samo unutar Max for Live devicea.'],
    [ago(h.hostFeedbackAt) < Infinity, 'Povratna informacija iz Livea stiže', 'Live → Settings → MIDI: izlaz Push3 UM → Remote ON (i nešto mapirano na tu kontrolu).'],
    [ago(h.hostClockAt) < 3, 'MIDI clock iz Livea stiže', 'Treba samo za sekvencer i animacije usklađene s tempom: izlaz Push3 UM → Sync ON, i Live mora svirati.'],
    [h.mode === 'user', 'Push je u User modu', 'Pritisni User na Pushu.'],
  ];
  box.innerHTML = '';
  for (const [ok, label, fix] of rows) box.append(el('li', {}, el('b', { style: `color:${ok ? 'var(--accent)' : 'var(--warn)'}` }, ok ? '✓ ' : '• '), label, ok ? null : el('div', { class: 'muted small' }, fix)));
}

function renderPresets() {
  const menu = $('#presetsMenu');
  menu.innerHTML = '';
  menu.append(el('div', { class: 'row' }, el('button', { onclick: exportConfig, title: 'Spremi cijelu konfiguraciju u .json datoteku' }, 'Izvezi .json'), el('button', { onclick: importConfig, title: 'Učitaj konfiguraciju iz .json datoteke' }, 'Uvezi .json')));
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
    send({ t: 'health' });
  };
  setInterval(() => {
    if (!$('#settings').classList.contains('hidden')) send({ t: 'health' });
  }, 2000);
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
    } else if (mod && e.key.toLowerCase() === 'c') {
      copySelection();
    } else if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      pasteSelection();
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
