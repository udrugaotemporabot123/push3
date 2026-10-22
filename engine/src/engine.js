'use strict';
// The engine: pure logic with injected I/O, so it can be unit-tested without hardware.
//
//   Push 3 User Port  --handlePushMessage-->  engine  --io.toHost-->  virtual port -> Live
//   Live (feedback)   --handleHostMessage-->  engine  --io.toPush-->  Push LEDs / sysex
//   Max LiveAPI       --handleLiveState---->  engine  --io.toLive-->  Max LiveAPI bridge
//
// Design rules:
// - Nothing is sent to the Push unless we know it is in User Mode (LED messages on the
//   User Port are ignored in Live Mode anyway, but sysex is not, so sysex is guarded).
// - LEDs go through a diff cache: entering User Mode repaints everything once, after that
//   only changes are sent.
// - Every control's state is kept per page, so feedback from Live updates pages that are
//   not visible and switching pages is instant.

const push3 = require('./push3');
const { normalizeConfig, pageChannel, range14, REPEAT_RATES } = require('./config');
const { dimOf, DEFAULT_PALETTE } = require('./palette');
const live = require('./live');

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const POLY_AT = 0xa0;
const CC = 0xb0;
const PC = 0xc0;
const CHAN_AT = 0xd0;
const PITCHBEND = 0xe0;

const CLOCK = 0xf8;
const START = 0xfa;
const CONTINUE = 0xfb;
const STOP = 0xfc;

const AT_QUERY_TIMEOUT_MS = 250;

// What a toggle sends, as a comparable string: a different signature means the old notes must stop.
function noteSignature(m, chan) {
  return JSON.stringify([m.type, m.number, chan, m.behavior, (m.extra || []).filter((x) => x.type === 'note')]);
}

class Engine {
  /**
   * @param {object} io { toPush(bytes), toHost(bytes), toLive(obj), log(level, msg), now(), setTimer(fn, ms), clearTimer(id) }
   */
  constructor(io, config) {
    this.io = io;
    this.listeners = new Set();
    this.mode = 'live'; // 'live' | 'user'
    this.pushConnected = false;
    this.page = 0;
    this.ledCache = new Map(); // ledKey -> encoded value
    this.pressed = new Set(); // control ids physically held
    this.heldOutputs = new Map(); // control id -> bytes to send on release (note offs etc.)
    this.liveHeld = new Map(); // control id -> Live parameter to reset on release (momentary)
    this.repeat = null; // active note repeat: { id, ticks, latch }
    this.repeating = new Map(); // pad id -> { note, chan, vel } retriggered on Live's clock
    this.repeatTick = 0;
    this.transpose = new Map(); // page uid -> semitones added to the page's pad notes (Oct-/Oct+)
    this.addonHeld = new Map(); // control id -> add-on mapping that got the press (release goes to the same one)
    this.touchHeld = new Map(); // encoder id -> touch note that was sent (its note off goes to the same note)
    this.mpeChannelPad = new Map(); // MPE member channel -> pad control (for pressure routing)
    this.lastPressure = new Map(); // control id -> last pressure value sent
    this.savedAftertouch = null;
    this.atQueryTimer = null;
    this.savedStrip = null;
    this.hostClockSeenAt = -Infinity;
    this.clockTimer = null;
    this.liveState = { variations: {}, values: {} }; // variations: key -> {count, selected, name, ok}; values: liveKey -> {ok, value, name, display, color}
    this.palette = DEFAULT_PALETTE;
    this.addons = new Map(); // id -> { mod, inst }
    this.discovered = new Map(); // unknown input key -> { bytes, count }
    this.health = { bridgeReady: false, hostFeedbackAt: 0, hostClockAt: 0, lastPushInputAt: 0 };
    this.setConfig(config);
  }

  // ---------------------------------------------------------------------------------------
  // Config

  setConfig(config) {
    const toggled = this.config ? this.toggledNotes() : [];
    const old = this.config;
    const curUid = old && old.pages[this.page] ? old.pages[this.page].uid : null;
    this.config = normalizeConfig(config);
    // State follows each page by its uid (moved/deleted pages keep their toggles and values).
    const oldState = this.state;
    const byUid = new Map();
    if (old && oldState) old.pages.forEach((p, i) => byUid.set(p.uid, oldState[i]));
    this.state = this.config.pages.map((p, i) => (old ? byUid.get(p.uid) : oldState && oldState[i]) || {});
    const moved = curUid ? this.config.pages.findIndex((p) => p.uid === curUid) : -1;
    if (moved >= 0) this.page = moved;
    if (this.page >= this.config.pages.length) this.page = 0;
    if (old) {
      this.stopDisabledAddons(old);
      this.resetEncoderScales(old);
    }
    // A toggled-on note whose mapping was edited would sound forever in Live: send its note off.
    for (const t of toggled) {
      const pi = this.config.pages.findIndex((p) => p.uid === t.uid);
      const now = pi >= 0 ? this.mapping(t.id, pi, t.layer) : null;
      if (now && noteSignature(now, this.channelFor(now, pi)) === t.sig) continue;
      for (const [ch, n] of t.notes) this.io.toHost([NOTE_ON | ch, n, 0]);
      const st = pi >= 0 && this.state[pi] && this.state[pi][t.layer ? `${t.id}#${t.layer}` : t.id];
      if (st) st.on = false;
    }
    this.buildFeedbackIndex();
    this.syncVariationTargets();
    if (this.mode === 'user') {
      this.ledCache.clear();
      this.renderAll();
      this.updateClock();
    }
    this.emit('config');
  }

  // An add-on switched off in Settings gets its held controls released and its clock stopped first,
  // so nothing it was playing keeps sounding (afterwards the engine no longer talks to it).
  stopDisabledAddons(old) {
    const was = (old.settings && old.settings.addons) || {};
    const now = this.config.settings.addons || {};
    for (const [id, a] of this.addons || []) {
      if (was[id] === false || now[id] !== false) continue;
      for (const [ctlId, m] of [...this.addonHeld]) {
        if (m.addon.id !== id) continue;
        this.addonHeld.delete(ctlId);
        try {
          if (a.inst.release) a.inst.release({ params: m.addon.params || {}, action: m.addon.action, id: ctlId });
        } catch (e) {
          this.io.log('error', `Add-on ${id}.release failed: ${e.message}`);
        }
      }
      try {
        if (a.inst.clock) a.inst.clock('stop');
      } catch (e) {
        this.io.log('error', `Add-on ${id}.clock failed: ${e.message}`);
      }
    }
  }

  // Encoder values are 0-127 in 7-bit modes and 0-16383 in absolute14: a mode switch starts fresh.
  resetEncoderScales(old) {
    const is14 = (m) => !!m && m.type === 'cc' && m.mode === 'absolute14';
    this.config.pages.forEach((page, pi) => {
      const before = old.pages.find((p) => p.uid === page.uid);
      if (!before) return;
      for (const [id, base] of Object.entries(page.controls)) {
        const prev = before.controls[id];
        if (!prev) continue;
        for (const [layer, m, pm] of [['', base, prev], ['s', base.shift, prev.shift]]) {
          if (is14(m) === is14(pm)) continue;
          const st = this.state[pi] && this.state[pi][layer ? `${id}#s` : id];
          if (st) st.value = null;
        }
      }
    });
  }

  // Toggles that are on and send notes (so a config edit can turn exactly those off).
  toggledNotes() {
    const out = [];
    this.config.pages.forEach((page, pi) => {
      for (const [id, base] of Object.entries(page.controls)) {
        for (const [layer, m] of [['', base], ['s', base.shift]]) {
          if (!m || m.behavior !== 'toggle') continue;
          const st = this.state[pi] && this.state[pi][layer ? `${id}#${layer}` : id];
          if (!st || !st.on) continue;
          const chan = this.channelFor(m, pi);
          const notes = [];
          if (m.type === 'note') notes.push([chan, m.number]);
          for (const x of m.extra || []) if (x.type === 'note') notes.push([x.channel ? x.channel - 1 : chan, x.number]);
          if (notes.length) out.push({ page: pi, uid: page.uid, id, layer, notes, sig: noteSignature(m, chan) });
        }
      }
    });
    return out;
  }

  // Map "status:channel:number" of messages coming back from Live to the controls they belong to.
  buildFeedbackIndex() {
    this.feedbackIndex = new Map();
    this.config.pages.forEach((page, pi) => {
      const ch = pageChannel(this.config, pi);
      for (const [id, base] of Object.entries(page.controls)) {
        for (const [layer, m] of [['', base], ['s', base.shift]]) {
          if (!m || (m.type !== 'note' && m.type !== 'cc')) continue;
          const chan = m.channel ? m.channel - 1 : ch;
          const key = `${m.type}:${chan}:${m.number}`;
          if (!this.feedbackIndex.has(key)) this.feedbackIndex.set(key, []);
          this.feedbackIndex.get(key).push({ page: pi, id, layer });
          if (m.type === 'cc' && m.mode === 'absolute14') {
            const lsbKey = `cc:${chan}:${m.number + 32}`;
            if (!this.feedbackIndex.has(lsbKey)) this.feedbackIndex.set(lsbKey, []);
            this.feedbackIndex.get(lsbKey).push({ page: pi, id, layer, lsb: true });
          }
        }
      }
    });
  }

  // Each layer ('' normal, 's' shift) keeps its own on/off and encoder value.
  ctlState(pageIndex, id, layer = this.layerFor(id, pageIndex)) {
    const s = this.state[pageIndex];
    const key = layer ? `${id}#${layer}` : id;
    if (!s[key]) s[key] = { on: false, value: null };
    return s[key];
  }

  shiftHeld() {
    return this.config.settings.shiftLayer && this.pressed.has('shift');
  }

  // The shift layer applies to a control only while Shift is held and the control has one.
  layerFor(id, pageIndex = this.page) {
    if (pageIndex !== this.page || !this.shiftHeld()) return '';
    const page = this.config.pages[pageIndex];
    const base = page && page.controls[id];
    return base && base.shift && base.shift.type !== 'none' ? 's' : '';
  }

  mapping(id, pageIndex = this.page, layer = this.layerFor(id, pageIndex)) {
    const page = this.config.pages[pageIndex];
    const base = page ? page.controls[id] : undefined;
    return layer === 's' && base ? base.shift : base;
  }

  channelFor(m, pageIndex = this.page) {
    return m.channel ? m.channel - 1 : pageChannel(this.config, pageIndex);
  }

  // ---------------------------------------------------------------------------------------
  // Events for the editor

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(what, data) {
    for (const fn of this.listeners) {
      try {
        fn(what, data);
      } catch (e) {
        this.io.log('error', `listener failed: ${e.message}`);
      }
    }
  }

  snapshot() {
    const ledState = {};
    for (const c of push3.controls) {
      const led = this.ledFor(c);
      if (led) ledState[c.id] = led;
    }
    return {
      mode: this.mode,
      pushConnected: this.pushConnected,
      page: this.page,
      leds: ledState,
      pressed: [...this.pressed],
      liveState: this.liveState,
      discovered: [...this.discovered.entries()].map(([key, v]) => ({ key, ...v })),
      health: { ...this.health, now: this.io.now() },
      savedAftertouch: this.savedAftertouch,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Connection / mode

  setPushConnected(connected) {
    this.pushConnected = connected;
    if (!connected) {
      this.releaseAllHeld();
      this.mode = 'live';
      this.ledCache.clear();
      this.savedAftertouch = null;
      this.stopClock();
    }
    this.emit('status');
  }

  enterUserMode(reason) {
    if (this.mode === 'user') return;
    this.mode = 'user';
    this.io.log('info', `User Mode on (${reason})`);
    this.ledCache.clear();
    this.mpeChannelPad.clear();
    this.renderAll();
    this.applyUserModeHardwareSettings();
    this.updateClock();
    this.emit('status');
  }

  exitUserMode(reason) {
    if (this.mode !== 'user') return;
    this.mode = 'live';
    this.io.log('info', `User Mode off (${reason})`);
    this.releaseAllHeld();
    this.restoreHardwareSettings();
    this.stopClock();
    this.ledCache.clear();
    this.emit('status');
  }

  applyUserModeHardwareSettings() {
    const s = this.config.settings;
    if (s.disableMpeInUserMode) {
      // Ask for the current mode first so we can restore exactly what Live had set.
      this.savedAftertouch = null;
      this.sysex([push3.SYSEX.GET_AFTERTOUCH_MODE]);
      if (this.atQueryTimer) this.io.clearTimer(this.atQueryTimer);
      this.atQueryTimer = this.io.setTimer(() => {
        this.atQueryTimer = null;
        // No reply: assume Push 3's default (MPE) so leaving User Mode restores it.
        if (this.mode === 'user' && this.savedAftertouch === null) {
          this.io.log('warn', 'No aftertouch-mode reply from Push; assuming MPE');
          this.savedAftertouch = push3.AFTERTOUCH.MPE;
          this.sysex([push3.SYSEX.SET_AFTERTOUCH_MODE, push3.AFTERTOUCH.POLY]);
        }
      }, AT_QUERY_TIMEOUT_MS);
    }
    if (s.stripFader) {
      this.savedStrip = null;
      this.sysex([push3.SYSEX.GET_TOUCHSTRIP_CONFIG]);
      // Push draws a bar from the bottom, no autoreturn, sends CC1 (Push 2 manual example 0x0C).
      this.sysex([push3.SYSEX.SET_TOUCHSTRIP_CONFIG, 0x0c]);
    }
  }

  restoreHardwareSettings() {
    if (this.atQueryTimer) {
      this.io.clearTimer(this.atQueryTimer);
      this.atQueryTimer = null;
    }
    if (this.savedAftertouch !== null && this.savedAftertouch !== push3.AFTERTOUCH.POLY) {
      this.sysex([push3.SYSEX.SET_AFTERTOUCH_MODE, this.savedAftertouch]);
    }
    this.savedAftertouch = null;
    if (this.savedStrip !== null) {
      this.sysex([push3.SYSEX.SET_TOUCHSTRIP_CONFIG, this.savedStrip]);
      this.savedStrip = null;
    }
  }

  sysex(body) {
    this.io.toPush([...push3.SYSEX_HEADER, ...body, 0xf7]);
  }

  handleSysex(bytes) {
    const h = push3.SYSEX_HEADER;
    if (bytes.length < h.length + 2) return;
    for (let i = 0; i < h.length; i++) if (bytes[i] !== h[i]) return;
    const cmd = bytes[h.length];
    const arg = bytes[h.length + 1];
    switch (cmd) {
      case push3.SYSEX.SET_MIDI_MODE:
        // Live switched the Push's MIDI mode; the reply is sent to both ports.
        if (arg === 1) this.enterUserMode('sysex');
        else if (arg === 0) this.exitUserMode('sysex');
        break;
      case push3.SYSEX.GET_AFTERTOUCH_MODE:
        if (this.mode !== 'user' || this.savedAftertouch !== null) break;
        this.savedAftertouch = arg;
        if (this.atQueryTimer) {
          this.io.clearTimer(this.atQueryTimer);
          this.atQueryTimer = null;
        }
        if (arg !== push3.AFTERTOUCH.POLY) this.sysex([push3.SYSEX.SET_AFTERTOUCH_MODE, push3.AFTERTOUCH.POLY]);
        break;
      case push3.SYSEX.GET_TOUCHSTRIP_CONFIG:
        if (this.mode === 'user' && this.savedStrip === null) this.savedStrip = arg;
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Input from the Push User Port

  handlePushMessage(bytes) {
    if (!bytes || !bytes.length) return;
    const status = bytes[0];
    if (status === 0xf0) return this.handleSysex(bytes);
    if (status >= 0xf8) return; // realtime (active sensing etc.)
    const type = status & 0xf0;
    const chan = status & 0x0f;
    const d1 = bytes[1];
    const d2 = bytes.length > 2 ? bytes[2] : 0;

    // The User button is sent to both ports in every mode; Live toggles the mode and we
    // learn the result from the sysex reply. It is never translated.
    if (type === CC && d1 === push3.USER_BUTTON_CC) return;

    // Channel mode messages (all notes off etc., sent by Push 3 at startup) carry no meaning.
    if (type === CC && d1 >= 120) return;

    // In Live Mode the Push sends nothing else on the User Port, so a real control event
    // means User Mode is active (covers starting up while already in User Mode).
    if (this.mode !== 'user') {
      const isControlEvent = (type === NOTE_ON && d2 > 0) || (type === CC && chan === 0 && d2 > 0) || (type === PITCHBEND && chan === 0);
      if (!isControlEvent) return;
      this.enterUserMode('activity');
    }

    if (type === NOTE_ON || type === NOTE_OFF) {
      const velocity = type === NOTE_OFF ? 0 : d2;
      const touch = chan === 0 ? push3.touchByNote.get(d1) : undefined;
      if (touch) return velocity > 0 ? this.press(touch, 127) : this.release(touch);
      const pad = push3.padByNote.get(d1);
      if (pad) {
        // MPE member channels (1-15) carry the same pad notes; remember them for pressure.
        if (chan !== 0) {
          if (velocity > 0) this.mpeChannelPad.set(chan, pad);
          else this.mpeChannelPad.delete(chan);
        }
        return velocity > 0 ? this.press(pad, velocity) : this.release(pad);
      }
      const enc = chan === 0 ? push3.encoderByTouchNote.get(d1) : undefined;
      if (enc) return this.encoderTouch(enc, velocity > 0);
      return this.discover(bytes);
    }

    if (type === CC) {
      if (chan !== 0) return; // MPE slide (CC74) etc. on member channels
      if (d1 === 1 && this.config.settings.stripFader) return this.stripValue(d2 << 7);
      const enc = push3.encoderByCc.get(d1);
      if (enc) return this.encoderTurn(enc, d2);
      const btn = push3.buttonByCc.get(d1);
      if (btn) return d2 > 0 ? this.press(btn, 127) : this.release(btn);
      return this.discover(bytes);
    }

    if (type === PITCHBEND) {
      if (chan === 0) return this.stripValue((d2 << 7) | d1);
      return; // per-pad MPE pitch bend
    }

    if (type === POLY_AT) {
      const pad = push3.padByNote.get(d1);
      if (pad) this.pressure(pad, d2);
      return;
    }

    if (type === CHAN_AT) {
      const pad = this.mpeChannelPad.get(chan);
      if (pad) this.pressure(pad, d1);
      return;
    }
  }

  discover(bytes) {
    const key = bytes.slice(0, 2).join(':');
    const entry = this.discovered.get(key) || { bytes: [...bytes], count: 0 };
    entry.count++;
    entry.bytes = [...bytes];
    this.discovered.set(key, entry);
    this.emit('discovered', entry);
  }

  // ---------------------------------------------------------------------------------------
  // Buttons and pads

  press(ctl, velocity) {
    this.pressed.add(ctl.id);
    this.emit('input', { id: ctl.id, kind: 'press', velocity });
    if (ctl.reserved) return;

    if (this.isPageButton(ctl)) {
      this.setPage(Number(ctl.id.split('.')[1]) - 1);
      return;
    }

    // Shift is a pure modifier while the shift layer is enabled: show the shift layer.
    if (ctl.id === 'shift' && this.config.settings.shiftLayer) {
      this.renderAll();
      return;
    }

    const layer = this.layerFor(ctl.id);
    let m = this.mapping(ctl.id, this.page, layer);
    if (!m) return;
    const st = this.ctlState(this.page, ctl.id, layer);

    switch (m.type) {
      case 'page':
        this.setPage(m.page);
        return;
      case 'pageHold':
        // Show another page only while this control is held.
        if (m.page !== this.page) {
          const ret = this.page;
          this.setPage(m.page);
          this.pageHold = { id: ctl.id, ret };
        }
        return;
      case 'pageNext':
        this.setPage((this.page + 1) % this.config.pages.length);
        return;
      case 'pagePrev':
        this.setPage((this.page - 1 + this.config.pages.length) % this.config.pages.length);
        return;
      case 'variation':
        this.variationPress(ctl, m);
        return;
      case 'live':
        this.livePress(ctl, m);
        return;
      case 'panic':
        this.panic();
        this.renderControl(ctl);
        return;
      case 'repeat': {
        const ticks = REPEAT_RATES[m.rate] || 6;
        if (m.behavior === 'toggle') this.repeat = this.repeat && this.repeat.id === ctl.id ? null : { id: ctl.id, ticks, latch: true };
        else this.repeat = { id: ctl.id, ticks, latch: false };
        this.emit('notice', { text: this.repeat ? `Repeat ${m.rate}` : 'Repeat off' });
        this.renderWhere((x) => x.type === 'repeat');
        return;
      }
      case 'transpose': {
        const uid = this.config.pages[this.page].uid;
        const t = m.amount === 0 ? 0 : Math.max(-48, Math.min(48, (this.transpose.get(uid) || 0) + m.amount));
        this.transpose.set(uid, t);
        this.emit('notice', { text: t ? `Transpose ${t > 0 ? '+' : ''}${t}${t % 12 ? '' : ` (oct ${t > 0 ? '+' : ''}${t / 12})`}` : 'Transpose 0' });
        this.renderWhere((x) => x.type === 'transpose');
        return;
      }
      case 'addon':
        this.addonHeld.set(ctl.id, m);
        this.addonCall(m, 'press', { id: ctl.id, velocity, shift: this.pressed.has('shift') });
        this.renderControl(ctl);
        return;
      case 'none':
        this.renderControl(ctl);
        return;
      default:
        break;
    }

    // Pad notes follow the page's transpose (Oct-/Oct+); toggles keep their note so they can be turned off.
    const shiftBy = ctl.kind === 'pad' && m.type === 'note' && m.behavior !== 'toggle' ? this.transpose.get(this.config.pages[this.page].uid) || 0 : 0;
    if (shiftBy) {
      const n = m.number + shiftBy;
      if (n < 0 || n > 127) return this.renderControl(ctl);
      m = { ...m, number: n };
    }
    const value = m.velocity === 'dynamic' ? scaleVelocity(applyCurve(velocity, m.curve), m) : m.onValue;
    const chan = this.channelFor(m);

    if (m.behavior === 'toggle') {
      st.on = !st.on;
      if (st.on && m.group) this.releaseGroup(ctl.id, m.group);
      this.sendValue(m, chan, st.on ? value : m.offValue, st.on);
    } else if (m.behavior === 'trigger') {
      if (m.group) this.releaseGroup(ctl.id, m.group, true);
      this.sendValue(m, chan, value, true);
      this.sendValue(m, chan, m.offValue, false);
      if (m.group) st.on = true;
    } else {
      if (m.group) this.releaseGroup(ctl.id, m.group);
      st.on = true;
      this.sendValue(m, chan, value, true);
      if (m.type !== 'pc') this.heldOutputs.set(ctl.id, { m, chan, layer });
      if (this.repeat && ctl.kind === 'pad' && m.type === 'note') this.repeating.set(ctl.id, { note: m.number, chan, vel: value });
    }
    this.renderControl(ctl);
  }

  release(ctl) {
    this.pressed.delete(ctl.id);
    this.repeating.delete(ctl.id);
    if (this.repeat && this.repeat.id === ctl.id && !this.repeat.latch) {
      this.repeat = null;
      this.renderWhere((x) => x.type === 'repeat');
    }
    this.emit('input', { id: ctl.id, kind: 'release' });
    if (this.lastPressure.has(ctl.id)) {
      const pm = this.mapping(ctl.id);
      if (pm && pm.pressure === 'live') this.liveAbsolute(pm.pressureLive, 0);
    }
    this.lastPressure.delete(ctl.id);
    if (this.pageHold && this.pageHold.id === ctl.id) {
      const ret = this.pageHold.ret;
      this.pageHold = null;
      this.setPage(ret);
      return;
    }
    if (ctl.id === 'shift' && this.config.settings.shiftLayer) {
      this.renderAll();
      return;
    }
    const am = this.addonHeld.get(ctl.id);
    if (am) {
      this.addonHeld.delete(ctl.id);
      this.addonCall(am, 'release', { id: ctl.id });
    }
    const lheld = this.liveHeld.get(ctl.id);
    if (lheld) {
      this.liveHeld.delete(ctl.id);
      this.io.toLive({ cmd: 'liveSet', key: lheld.key, spec: lheld.spec, value: 0 });
    }
    const held = this.heldOutputs.get(ctl.id);
    if (held) {
      this.heldOutputs.delete(ctl.id);
      this.sendValue(held.m, held.chan, held.m.offValue, false);
      if (held.m.behavior === 'momentary' && !held.m.group) this.ctlState(this.page, ctl.id, held.layer).on = false;
    }
    this.renderControl(ctl);
  }

  // Send the "off" side of everything still held (mode switch, page switch, disconnect),
  // so nothing gets stuck in Live.
  releaseAllHeld() {
    for (const [id, held] of this.heldOutputs) {
      this.sendValue(held.m, held.chan, held.m.offValue, false);
      const key = held.layer ? `${id}#${held.layer}` : id;
      const s = this.state[this.page] && this.state[this.page][key];
      if (s && held.m.behavior === 'momentary' && !held.m.group) s.on = false;
    }
    this.heldOutputs.clear();
    this.repeating.clear();
    if (this.repeat && !this.repeat.latch) this.repeat = null;
    for (const lh of this.liveHeld.values()) this.io.toLive({ cmd: 'liveSet', key: lh.key, spec: lh.spec, value: 0 });
    this.liveHeld.clear();
    const addonHeld = [...this.addonHeld];
    this.addonHeld.clear();
    for (const [id, m] of addonHeld) this.addonCall(m, 'release', { id });
    for (const t of this.touchHeld.values()) this.io.toHost([NOTE_ON | t.chan, t.note, 0]);
    this.touchHeld.clear();
    this.pressed.clear();
    this.lastPressure.clear();
  }

  // All notes / sound off on every channel of the virtual port.
  panic() {
    this.releaseAllHeld();
    for (let ch = 0; ch < 16; ch++) {
      this.io.toHost([CC | ch, 64, 0]); // sustain off
      this.io.toHost([CC | ch, 123, 0]); // all notes off
    }
    this.io.log('info', 'Panic: all notes off');
  }

  // Exclusive groups ("radio buttons") within the current page.
  releaseGroup(exceptId, group, silent = false) {
    const page = this.config.pages[this.page];
    for (const id of Object.keys(page.controls)) {
      const m = this.mapping(id);
      if (id === exceptId || !m || m.group !== group) continue;
      const st = this.ctlState(this.page, id);
      if (!st.on) continue;
      st.on = false;
      if (m.behavior === 'toggle') {
        const chan = this.channelFor(m);
        if (!silent) this.sendValue(m, chan, m.offValue, false);
        // Even a silent release must not leave a toggled note sounding in Live.
        else for (const x of [m, ...(m.extra || [])]) if (x.type === 'note') this.io.toHost([NOTE_ON | (x.channel && x !== m ? x.channel - 1 : chan), x.number, 0]);
      }
      this.renderControl(push3.byId.get(id));
    }
  }

  sendValue(m, chan, value, isOn) {
    this.sendOne(m, chan, value, isOn);
    if (m.extra) for (const x of m.extra) this.sendOne({ type: x.type, number: x.number }, x.channel ? x.channel - 1 : chan, value, isOn);
  }

  sendOne(m, chan, value, isOn) {
    switch (m.type) {
      case 'note':
        // Note-off as note-on with velocity 0 keeps running status simple for Live.
        this.io.toHost([NOTE_ON | chan, m.number, isOn ? Math.max(1, value) : 0]);
        break;
      case 'cc':
        this.io.toHost([CC | chan, m.number, value]);
        break;
      case 'pc':
        if (isOn) this.io.toHost([PC | chan, m.number]);
        break;
      default:
        break;
    }
  }

  pressure(ctl, value) {
    const rep = this.repeating.get(ctl.id);
    if (rep && value > 0) rep.vel = value; // note repeat: pressing harder = louder repeats
    const m = this.mapping(ctl.id);
    if (!m || m.type === 'none' || !m.pressure || m.pressure === 'off') return;
    if (this.lastPressure.get(ctl.id) === value) return;
    this.lastPressure.set(ctl.id, value);
    if (m.pressure === 'live') return this.liveAbsolute(m.pressureLive, value / 127);
    const chan = this.channelFor(m);
    if (m.pressure === 'polyAT' && m.type === 'note') this.io.toHost([POLY_AT | chan, m.number, value]);
    else if (m.pressure === 'channelAT') this.io.toHost([CHAN_AT | chan, value]);
    else if (m.pressure === 'cc') this.io.toHost([CC | chan, m.pressureCc, value]);
  }

  // ---------------------------------------------------------------------------------------
  // Encoders and touch strip

  encoderTurn(ctl, raw) {
    const delta = raw < 64 ? raw : raw - 128; // two's complement
    this.emit('input', { id: ctl.id, kind: 'turn', delta });
    const m = this.mapping(ctl.id);
    // Shift + encoder = fine adjustment (unless the encoder has its own shift mapping).
    const fine = this.config.settings.shiftFine && this.pressed.has('shift') && this.layerFor(ctl.id) === '' ? 0.1 : 1;
    // While an add-on control is held, the add-on may take the encoder (e.g. step velocity).
    if (this.addonHeld.size && delta !== 0) {
      let used = false;
      for (const [id, am] of this.addonHeld) if (this.addonCall(am, 'turn', { id, encoder: ctl.id, delta: delta * fine }) === true) used = true;
      if (used) return;
    }
    if (m && m.type === 'live' && delta !== 0) return this.liveTurn(ctl, m, delta * fine);
    if (!m || m.type !== 'cc' || delta === 0) return;
    const chan = this.channelFor(m);
    if (m.mode === 'relative2c') {
      const d = Math.max(-63, Math.min(63, delta));
      this.io.toHost([CC | chan, m.number, d >= 0 ? d : 128 + d]);
      return;
    }
    if (m.mode === 'steps') {
      // Accumulate detents; every stepSize detents fire one up/down trigger (on + off).
      const st = this.ctlState(this.page, ctl.id);
      st.acc = (st.acc || 0) + delta;
      while (Math.abs(st.acc) >= m.stepSize) {
        const up = st.acc > 0;
        st.acc += up ? -m.stepSize : m.stepSize;
        const number = up ? m.upNumber : m.downNumber;
        const status = m.stepType === 'note' ? NOTE_ON : CC;
        this.io.toHost([status | chan, number, 127]);
        this.io.toHost([status | chan, number, 0]);
      }
      return;
    }
    if (m.mode === 'relativeOffset') {
      this.io.toHost([CC | chan, m.number, Math.max(1, Math.min(127, 64 + delta))]);
      return;
    }
    if (m.mode === 'absolute14') {
      // Same travel as 7-bit (sensitivity in 7-bit steps); Shift (fine) moves ~13 of 16384 per detent.
      const [lo, hi] = range14(m);
      const st = this.ctlState(this.page, ctl.id);
      if (st.value === null) st.value = lo;
      const prev = Math.round(st.value);
      st.value = Math.min(hi, Math.max(lo, st.value + delta * m.sensitivity * 128 * fine));
      const next = Math.round(st.value);
      if (next !== prev) {
        this.io.toHost([CC | chan, m.number, next >> 7]);
        this.io.toHost([CC | chan, m.number + 32, next & 0x7f]);
      }
      this.emit('value', { page: this.page, id: ctl.id, value: next / 128 });
      return;
    }
    const st = this.ctlState(this.page, ctl.id);
    if (st.value === null) st.value = m.min;
    const prev = Math.round(st.value);
    st.value = Math.min(m.max, Math.max(m.min, st.value + delta * m.sensitivity * fine));
    const next = Math.round(st.value);
    if (next !== prev) this.io.toHost([CC | chan, m.number, next]);
    this.emit('value', { page: this.page, id: ctl.id, value: next });
  }

  encoderTouch(ctl, touched) {
    this.emit('input', { id: ctl.id, kind: touched ? 'touch' : 'untouch' });
    if (touched) this.pressed.add(ctl.id);
    else this.pressed.delete(ctl.id);
    const prev = this.touchHeld.get(ctl.id);
    if (prev) {
      this.touchHeld.delete(ctl.id);
      this.io.toHost([NOTE_ON | prev.chan, prev.note, 0]);
    }
    if (!touched) return;
    const m = this.mapping(ctl.id);
    if (!m || m.type === 'none' || m.touch !== 'note') return;
    const t = { chan: this.channelFor(m), note: m.touchNumber };
    this.touchHeld.set(ctl.id, t);
    this.io.toHost([NOTE_ON | t.chan, t.note, 127]);
  }

  stripValue(value14) {
    const ctl = push3.byId.get('strip');
    this.emit('input', { id: ctl.id, kind: 'strip', value: value14 });
    const m = this.mapping(ctl.id);
    if (!m || m.type === 'none') return;
    if (m.type === 'live') return this.liveAbsolute(m.live, value14 / 16383);
    const chan = this.channelFor(m);
    if (m.type === 'pitchbend') this.io.toHost([PITCHBEND | chan, value14 & 0x7f, value14 >> 7]);
    else this.io.toHost([CC | chan, m.number, value14 >> 7]);
  }

  // ---------------------------------------------------------------------------------------
  // Pages

  isPageButton(ctl) {
    return this.config.settings.pageButtons === 'upper' && ctl.id.startsWith('upper.');
  }

  setPage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.config.pages.length || index === this.page) {
      this.renderPageButtons();
      return;
    }
    this.releaseAllHeld();
    this.page = index;
    this.renderAll();
    this.emit('page', index);
  }

  // ---------------------------------------------------------------------------------------
  // Feedback from Live (MIDI on the virtual port) and clock

  handleHostMessage(bytes) {
    if (!bytes || !bytes.length) return;
    const status = bytes[0];
    if (status >= 0xf8) return this.handleHostRealtime(status);
    this.health.hostFeedbackAt = this.io.now();
    const type = status & 0xf0;
    const chan = status & 0x0f;
    let key;
    let value;
    if (type === CC) {
      key = `cc:${chan}:${bytes[1]}`;
      value = bytes[2];
    } else if (type === NOTE_ON || type === NOTE_OFF) {
      key = `note:${chan}:${bytes[1]}`;
      value = type === NOTE_OFF ? 0 : bytes[2];
    } else return;
    const targets = this.feedbackIndex.get(key);
    if (!targets) return;
    for (const t of targets) {
      const ctl = push3.byId.get(t.id);
      const m = this.mapping(t.id, t.page, t.layer);
      const st = this.ctlState(t.page, t.id, t.layer);
      const visible = t.page === this.page && this.layerFor(t.id) === t.layer;
      if (ctl.kind === 'encoder' && m.mode === 'absolute14') {
        const [lo, hi] = range14(m);
        const cur = st.value === null ? 0 : Math.round(st.value);
        const v14 = t.lsb ? (cur & ~0x7f) | value : value << 7;
        st.value = Math.min(hi, Math.max(lo, v14));
        this.emit('value', { page: t.page, id: t.id, value: st.value / 128 });
      } else if (ctl.kind === 'encoder') {
        st.value = Math.min(m.max, Math.max(m.min, value));
        this.emit('value', { page: t.page, id: t.id, value });
      } else {
        // While a momentary control is held, its own echo must not turn the LED off early.
        if (visible && this.heldOutputs.has(t.id) && value === 0) continue;
        st.on = value > 0;
        if (visible) this.renderControl(ctl);
      }
    }
  }

  handleHostRealtime(status) {
    if (status === CLOCK || status === START || status === CONTINUE || status === STOP) {
      this.hostClockSeenAt = this.io.now();
      this.health.hostClockAt = this.hostClockSeenAt;
      if (this.mode === 'user') this.io.toPush([status]);
      // Add-ons that follow Live's clock (sequencers) get every tick, also outside User Mode.
      const type = status === CLOCK ? 'clock' : status === START ? 'start' : status === STOP ? 'stop' : 'continue';
      if (status === START) this.repeatTick = 0;
      else if (status === CLOCK) this.noteRepeatTick();
      for (const [id, a] of this.addons) {
        if (typeof a.inst.clock !== 'function' || (this.config.settings.addons && this.config.settings.addons[id] === false)) continue;
        try {
          a.inst.clock(type);
        } catch (e) {
          this.io.log('error', `Add-on ${id}.clock failed: ${e.message}`);
        }
      }
    }
  }

  // Note repeat: every `ticks` clock ticks (from Live's start, so on the grid) each held pad retriggers.
  noteRepeatTick() {
    this.repeatTick++;
    if (!this.repeat || !this.repeating.size || this.mode !== 'user') return;
    if (this.repeatTick % this.repeat.ticks !== 0) return;
    for (const r of this.repeating.values()) {
      this.io.toHost([NOTE_ON | r.chan, r.note, 0]);
      this.io.toHost([NOTE_ON | r.chan, r.note, Math.max(1, r.vel)]);
    }
  }

  // Blink/pulse animations only run while the Push receives MIDI clock on the User Port.
  // Use Live's clock when it arrives, otherwise generate 120 BPM ourselves.
  updateClock() {
    const needed = this.mode === 'user' && this.config.settings.internalClock && this.usesAnimation();
    if (needed && !this.clockTimer) {
      this.io.toPush([START]);
      const tick = () => {
        if (this.io.now() - this.hostClockSeenAt > 1000) this.io.toPush([CLOCK]);
      };
      this.clockTimer = this.io.setInterval(tick, 1000 / 48);
    } else if (!needed) this.stopClock();
  }

  stopClock() {
    if (this.clockTimer) {
      this.io.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  usesAnimation() {
    const page = this.config.pages[this.page];
    return page && Object.values(page.controls).some((m) => (m.anim && m.anim !== 'none') || m.type === 'addon' || (m.type === 'live' && m.live && m.live.action === 'clip'));
  }

  // ---------------------------------------------------------------------------------------
  // Live API bridge (rack variations)

  // Tell the Live API bridge what to observe: rack variations and Live-aware controls.
  syncVariationTargets() {
    const targets = {};
    const liveTargets = {};
    for (const [pageIndex, page] of this.config.pages.entries()) {
      for (const [ctlId, base] of Object.entries(page.controls)) {
        for (const m of [base, base.shift]) {
          if (!m) continue;
          if (m.type === 'variation') targets[variationKey(m.target)] = m.target;
          const spec = this.liveSpec(m);
          if (spec) liveTargets[live.liveKey(spec)] = spec;
          if (m.pressure === 'live' && m.pressureLive) {
            const ps = live.specForEncoder(m.pressureLive);
            liveTargets[live.liveKey(ps)] = ps;
          }
          if (m.type === 'addon') {
            const a = this.addonFor(m);
            let specs = [];
            try {
              specs = a && a.inst.watch ? a.inst.watch(m.addon.params || {}, m.addon.action, { page: pageIndex, id: ctlId, channel: m.channel ? m.channel - 1 : pageChannel(this.config, pageIndex) }) || [] : [];
            } catch (e) {
              this.io.log('error', `Add-on ${m.addon.id}.watch failed: ${e.message}`);
            }
            for (const sp of specs) liveTargets[live.liveKey(sp)] = sp;
          }
        }
      }
    }
    // Always observe transport for the display (tempo, playing).
    for (const spec of [{ t: 'song', prop: 'is_playing' }, { t: 'param', target: 'tempo' }]) liveTargets[live.liveKey(spec)] = spec;
    this.variationTargets = targets;
    this.liveTargets = liveTargets;
    this.io.toLive({ cmd: 'watch', targets });
    this.io.toLive({ cmd: 'watchLive', targets: liveTargets });
  }

  setPalette(palette) {
    this.palette = palette;
  }

  // Add-ons: each gets a small API; every call into an add-on is guarded.
  setAddons(mods) {
    const api = {
      toLive: (o) => this.io.toLive(o),
      sendHost: (bytes) => this.io.toHost(bytes),
      pageChannel: (page = this.page) => pageChannel(this.config, page),
      renderAddons: () => this.renderWhere((m) => m.type === 'addon'),
      loadState: (id) => (this.io.loadAddonState ? this.io.loadAddonState(id) : null),
      saveState: (id, data) => this.io.saveAddonState && this.io.saveAddonState(id, data),
      liveValue: (spec) => this.liveState.values[live.liveKey(spec)],
      liveKey: live.liveKey,
      log: (level, msg) => this.io.log(level, msg),
      ANIM: push3.ANIMATIONS,
      SLOT: live.SLOT,
    };
    this.addons = new Map();
    for (const mod of mods) {
      try {
        this.addons.set(mod.id, { mod, inst: mod.create(api) });
      } catch (e) {
        this.io.log('error', `Add-on ${mod.id} failed to start: ${e.message}`);
      }
    }
    this.syncVariationTargets();
    if (this.mode === 'user') this.renderAll();
  }

  addonFor(m) {
    if (!m || m.type !== 'addon' || !m.addon) return null;
    if (this.config.settings.addons && this.config.settings.addons[m.addon.id] === false) return null;
    return this.addons.get(m.addon.id) || null;
  }

  addonCall(m, fn, extra = {}) {
    const a = this.addonFor(m);
    if (!a || typeof a.inst[fn] !== 'function') return undefined;
    try {
      return a.inst[fn]({ params: m.addon.params || {}, action: m.addon.action, ...extra });
    } catch (e) {
      this.io.log('error', `Add-on ${m.addon.id}.${fn} failed: ${e.message}`);
      return undefined;
    }
  }

  // One short status text per add-on instance used on the current page (shown on the display).
  addonStatus() {
    const page = this.config.pages[this.page];
    if (!page) return [];
    const seen = new Set();
    const out = [];
    for (const c of Object.values(page.controls)) {
      for (const m of [c, c && c.shift]) {
        if (!m || m.type !== 'addon' || !m.addon) continue;
        const p = m.addon.params || {};
        const key = `${m.addon.id}|${p.seq || ''}|${p.track || p.source || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const s = this.addonCall(m, 'status');
        if (s && !out.includes(s)) out.push(String(s));
      }
    }
    return out.slice(0, 3);
  }

  // Full-screen view of the first add-on on the current page that offers one (page display "addon").
  addonView() {
    const page = this.config.pages[this.page];
    if (!page) return null;
    for (const c of Object.values(page.controls)) {
      if (!c || c.type !== 'addon') continue;
      const a = this.addonFor(c);
      if (!a || typeof a.inst.view !== 'function') continue;
      const v = this.addonCall(c, 'view');
      if (v && Array.isArray(v.rows)) return v;
    }
    return null;
  }

  // Label of an add-on action as the add-on names it.
  addonLabel(m) {
    const a = this.addonFor(m);
    const act = a && a.mod.actions && a.mod.actions[m.addon.action];
    return act ? act.label : '';
  }

  liveSpec(m) {
    if (!m || m.type !== 'live' || !m.live) return null;
    return m.live.target ? live.specForEncoder(m.live) : live.specForButton(m.live);
  }

  liveValue(m) {
    const spec = this.liveSpec(m);
    return spec ? this.liveState.values[live.liveKey(spec)] : undefined;
  }

  // Clip slot LED: empty = off colour, clip = its colour (dim), playing = pulse, recording = red blink.
  clipLed(m, held) {
    const v = this.liveValue(m);
    if (held) return { color: 3, anim: 0 };
    if (!v || !v.ok || v.value === live.SLOT.EMPTY) return { color: m.colorOff, anim: 0 };
    const c = v.color ? live.nearestPaletteIndex(v.color, this.palette) : m.colorOn;
    switch (v.value) {
      case live.SLOT.PLAYING:
        return { color: c, anim: push3.ANIMATIONS.pulse };
      case live.SLOT.RECORDING:
        return { color: 5, anim: push3.ANIMATIONS.blink };
      case live.SLOT.TRIGGERED:
        return { color: c, anim: push3.ANIMATIONS['blink-fast'] };
      default:
        return { color: dimOf(c), anim: 0 };
    }
  }

  livePress(ctl, m) {
    const a = m.live.action;
    const spec = live.specForButton(m.live);
    const cur = this.liveValue(m);
    if (a === 'param') {
      const mode = m.live.mode;
      const key = live.liveKey(spec);
      const next = mode === 'toggle' ? !(cur && cur.value >= 0.5) : true;
      this.io.toLive({ cmd: 'liveSet', key, spec, value: next ? 1 : 0 });
      if (cur) cur.value = next ? 1 : 0;
      if (mode === 'trigger') this.io.toLive({ cmd: 'liveSet', key, spec, value: 0 });
      if (mode === 'momentary') this.liveHeld.set(ctl.id, { key, spec });
    } else if (spec && (spec.t === 'trackProp' || spec.t === 'song')) {
      // Toggle whatever Live currently reports (true if unknown).
      const next = !(cur && cur.value);
      this.io.toLive({ cmd: 'liveSet', key: live.liveKey(spec), spec, value: next ? 1 : 0 });
      if (cur) cur.value = next ? 1 : 0; // optimistic, corrected by the observer
    } else if (a === 'clip' || a === 'clipDelete') {
      this.io.toLive({ cmd: 'liveCall', spec, fn: a === 'clip' ? 'fireSlot' : 'deleteSlot' });
    } else if (/^(track|scene|device)(Prev|Next)$/.test(a)) {
      this.io.toLive({ cmd: 'liveCall', spec: { t: 'nav' }, fn: a });
    } else if (a === 'stopTrack') {
      this.io.toLive({ cmd: 'liveCall', spec: { t: 'trackSelect', track: m.live.track }, fn: 'stopTrack' });
    } else if (a === 'select') {
      this.io.toLive({ cmd: 'liveCall', spec: { t: 'trackSelect', track: m.live.track }, fn: 'select' });
    } else if (a === 'scene') {
      this.io.toLive({ cmd: 'liveCall', spec: { t: 'scene', index: m.live.scene }, fn: 'fire' });
    } else {
      this.io.toLive({ cmd: 'liveCall', spec: { t: 'song' }, fn: a });
    }
    this.renderControl(ctl);
  }

  // Absolute 0..1 value to a Live parameter (touch strip, pad pressure); duplicates are skipped.
  liveAbsolute(target, value) {
    if (!target) return;
    const spec = live.specForEncoder(target);
    const key = live.liveKey(spec);
    const v = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
    const cur = this.liveState.values[key] || (this.liveState.values[key] = { ok: false, value: -1 });
    if (cur.value === v) return;
    cur.value = v;
    this.io.toLive({ cmd: 'liveSet', key, spec, value: v });
  }

  liveTurn(ctl, m, delta) {
    const spec = live.specForEncoder(m.live);
    const key = live.liveKey(spec);
    const cur = this.liveState.values[key] || (this.liveState.values[key] = { ok: false, value: 0 });
    const next = Math.min(1, Math.max(0, (Number(cur.value) || 0) + (delta * m.sensitivity) / 127));
    if (next === cur.value) return;
    cur.value = next; // optimistic so fast turns accumulate
    this.io.toLive({ cmd: 'liveSet', key, spec, value: next });
    this.emit('value', { page: this.page, id: ctl.id, value: next });
  }

  variationPress(ctl, m) {
    const shift = this.pressed.has('shift');
    const action = shift && m.action === 'recall' ? 'store' : m.action;
    this.io.toLive({ cmd: 'variation', key: variationKey(m.target), target: m.target, action, index: m.index });
    this.renderControl(ctl);
  }

  handleLiveState(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'variations' && msg.key) {
      this.liveState.variations[msg.key] = {
        ok: !!msg.ok,
        count: Number(msg.count) || 0,
        selected: Number.isInteger(msg.selected) ? msg.selected : -1,
        name: typeof msg.name === 'string' ? msg.name : '',
      };
      this.renderWhere((m) => m.type === 'variation' && variationKey(m.target) === msg.key);
      this.emit('live', msg);
    } else if (msg.type === 'notice' && typeof msg.text === 'string') {
      this.io.log('info', msg.text);
      this.emit('notice', { text: msg.text.slice(0, 80) });
    } else if (msg.type === 'live' && msg.key) {
      this.liveState.values[msg.key] = {
        ok: !!msg.ok,
        value: Array.isArray(msg.value) ? msg.value : Number(msg.value) || 0,
        name: typeof msg.name === 'string' ? msg.name : '',
        display: typeof msg.display === 'string' ? msg.display : '',
        color: Array.isArray(msg.color) ? msg.color : null,
        track: typeof msg.track === 'string' ? msg.track : '',
      };
      this.renderWhere((m) => {
        if (m.type === 'addon') return true; // add-ons may depend on any observed value
        const spec = this.liveSpec(m);
        return !!spec && live.liveKey(spec) === msg.key;
      });
      this.emit('live', msg);
    }
  }

  // ---------------------------------------------------------------------------------------
  // LEDs

  ledFor(ctl) {
    if (ctl.reserved || ctl.led === 'none' || ctl.kind === 'encoder' || ctl.kind === 'touchstrip') return null;
    if (this.isPageButton(ctl)) {
      const idx = Number(ctl.id.split('.')[1]) - 1;
      const page = this.config.pages[idx];
      if (!page) return { color: 0, anim: 0 };
      return { color: idx === this.page ? page.color : dimOf(page.color), anim: 0 };
    }
    if (ctl.id === 'shift' && this.config.settings.shiftLayer) return { color: this.pressed.has('shift') ? 127 : 16, anim: 0 };
    const m = this.mapping(ctl.id);
    if (!m) return { color: 0, anim: 0 };
    const held = this.pressed.has(ctl.id);
    if (m.type === 'none') {
      if (held) return { color: ctl.led === 'rgb' ? 3 : 127, anim: 0 };
      return { color: this.config.settings.unmappedLeds === 'dim' ? (ctl.led === 'rgb' ? 1 : 8) : 0, anim: 0 };
    }
    if (m.type === 'addon') {
      const led = this.addonCall(m, 'led', { id: ctl.id, held });
      return led && Number.isInteger(led.color) ? { color: Math.max(0, Math.min(127, led.color)), anim: led.anim | 0 } : { color: 0, anim: 0 };
    }
    if (m.type === 'live' && m.live.action === 'clip') return this.clipLed(m, held);
    if (m.type === 'live') {
      const v = this.liveValue(m);
      const on = held || !!(v && v.ok && v.value >= 0.5);
      if (!on) return { color: v && v.ok ? m.colorOff : 0, anim: 0 };
      const color = m.live.trackColor && v && v.color ? live.nearestPaletteIndex(v.color, this.palette) : m.colorOn;
      return { color, anim: v && v.value ? push3.ANIMATIONS[m.anim] || 0 : 0 };
    }
    if (m.type === 'variation') {
      const v = this.liveState.variations[variationKey(m.target)];
      if (held) return { color: m.colorOn, anim: 0 };
      if (!v || !v.ok) return { color: 0, anim: 0 };
      if (m.action !== 'recall') return { color: m.colorOff, anim: 0 };
      if (m.index >= v.count) return { color: 0, anim: 0 };
      return m.index === v.selected ? { color: m.colorOn, anim: push3.ANIMATIONS[m.anim] || 0 } : { color: m.colorOff, anim: 0 };
    }
    if (m.type === 'repeat') return { color: held || (this.repeat && this.repeat.id === ctl.id) ? m.colorOn : m.colorOff, anim: 0 };
    if (m.type === 'transpose') {
      const t = this.transpose.get(this.config.pages[this.page].uid) || 0;
      const active = held || (m.amount > 0 ? t > 0 : m.amount < 0 ? t < 0 : t !== 0);
      return { color: active ? m.colorOn : m.colorOff, anim: 0 };
    }
    if (m.type === 'page' || m.type === 'pageHold' || m.type === 'pageNext' || m.type === 'pagePrev') {
      const active = (m.type === 'page' || m.type === 'pageHold') && m.page === this.page;
      return { color: held || active ? m.colorOn : m.colorOff, anim: 0 };
    }
    const st = this.ctlState(this.page, ctl.id);
    const on = st.on || held;
    return { color: on ? m.colorOn : m.colorOff, anim: on ? push3.ANIMATIONS[m.anim] || 0 : 0 };
  }

  renderControl(ctl) {
    if (!ctl) return;
    const led = this.ledFor(ctl);
    if (led) {
      this.emit('led', { id: ctl.id, ...led });
      if (this.mode === 'user') this.sendLed(ctl, led);
    }
  }

  renderWhere(pred) {
    const page = this.config.pages[this.page];
    for (const [id, m] of Object.entries(page.controls)) {
      if (pred(m)) this.renderControl(push3.byId.get(id));
    }
  }

  renderPageButtons() {
    for (let i = 1; i <= 8; i++) this.renderControl(push3.byId.get(`upper.${i}`));
  }

  renderAll() {
    for (const ctl of push3.controls) this.renderControl(ctl);
    this.updateClock();
  }

  sendLed(ctl, led) {
    const isNote = ctl.kind === 'pad';
    const number = isNote ? ctl.note : ctl.cc;
    const key = `${isNote ? 'n' : 'c'}${number}`;
    const enc = led.anim * 128 + led.color;
    if (this.ledCache.get(key) === enc) return;
    this.ledCache.set(key, enc);
    const status = isNote ? NOTE_ON : CC;
    if (led.anim) {
      // Animation: base colour on channel 0, target colour on the animation channel.
      this.io.toPush([status, number, led.color === 0 ? 0 : dimOf(led.color)]);
      this.io.toPush([status | led.anim, number, led.color]);
    } else {
      this.io.toPush([status, number, led.color]);
    }
  }
}

const CURVES = { soft: 0.6, linear: 1, hard: 1.7 };
function applyCurve(velocity, curve) {
  const g = CURVES[curve] || 1;
  if (g === 1) return velocity;
  return Math.max(1, Math.min(127, Math.round(127 * Math.pow(velocity / 127, g))));
}

function scaleVelocity(velocity, m) {
  // Map 1..127 onto offValue+1..onValue so "dynamic" still respects the configured range.
  const lo = Math.min(127, m.offValue + 1);
  const hi = Math.max(lo, m.onValue);
  return Math.round(lo + ((velocity - 1) / 126) * (hi - lo));
}

function variationKey(target) {
  return `${target.track}|${target.device}`;
}

module.exports = { Engine, variationKey, scaleVelocity, applyCurve };
