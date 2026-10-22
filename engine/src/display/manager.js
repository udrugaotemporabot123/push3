'use strict';
// Display manager: renders the controller page whenever engine state changes (max ~30 fps),
// mirrors it to the editor as PNG (~10 fps) and, if enabled, pushes it to the hardware display
// while User Mode is active.

const { Canvas } = require('./canvas');
const { buildModel, draw, summary } = require('./layout');
const { UsbTransport } = require('./usb-transport');
const push3 = require('../push3');

const RENDER_MS = 33;
const PREVIEW_MS = 100;
const KEEPALIVE_MS = 500; // the display blanks after ~2 s without frames

class DisplayManager {
  constructor({ engine, palette, log, onPreview, transport }) {
    this.engine = engine;
    this.palette = palette;
    this.log = log;
    this.onPreview = onPreview;
    this.transport = transport || new UsbTransport(log);
    this.canvas = new Canvas();
    this.frame = null;
    this.lastAction = null;
    this.renderTimer = null;
    this.lastPreview = 0;
    this.previewTimer = null;
    this.keepalive = null;
    this.previewWanted = false;
    this.wasUser = false;

    engine.onChange((what, data) => this.onEngine(what, data));
  }

  get wantsHardware() {
    return this.engine.config.settings.display === 'takeover';
  }

  onEngine(what, data) {
    if (what === 'input') this.recordAction(data);
    if (what === 'notice') {
      this.lastAction = { title: data.text, detail: '', at: Date.now() };
      clearTimeout(this.actionTimer);
      this.actionTimer = setTimeout(() => this.schedule(), 1600);
    }
    if (what === 'status' || what === 'config') this.syncTransport();
    if (['led', 'input', 'value', 'page', 'status', 'config', 'live', 'notice'].includes(what)) this.schedule();
  }

  recordAction(ev) {
    const ctl = push3.byId.get(ev.id);
    if (!ctl || ev.kind === 'release' || ev.kind === 'untouch') return;
    const m = this.engine.mapping(ev.id);
    let detail = summary(ctl, m);
    if (ev.kind === 'turn') {
      const st = this.engine.ctlState(this.engine.page, ev.id);
      if (m && m.mode === 'absolute' && st.value !== null) detail = `${detail}  ${Math.round(st.value)}`;
    } else if (ev.kind === 'press' && m && m.behavior === 'toggle') {
      detail = `${detail}  ${this.engine.ctlState(this.engine.page, ev.id).on ? 'ON' : 'OFF'}`;
    }
    this.lastAction = { title: (m && m.label) || ctl.label, detail, at: Date.now() };
    // Clear the action line again after it expires.
    clearTimeout(this.actionTimer);
    this.actionTimer = setTimeout(() => this.schedule(), 1600);
  }

  async syncTransport() {
    const user = this.engine.mode === 'user';
    if (user && this.wantsHardware) {
      if (this.transport.state === 'closed' || this.transport.state === 'error' || (!this.wasUser && this.transport.state === 'busy')) {
        await this.transport.open();
        if (this.transport.state === 'active') this.startKeepalive();
        this.schedule();
      }
    } else if (this.transport.state === 'active' || this.transport.state === 'opening') {
      this.stopKeepalive();
      await this.transport.close();
    }
    this.wasUser = user;
  }

  startKeepalive() {
    this.stopKeepalive();
    this.keepalive = setInterval(() => {
      if (this.frame) this.transport.send(this.frame);
    }, KEEPALIVE_MS);
  }

  stopKeepalive() {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  setPreview(on) {
    this.previewWanted = on;
    if (on) this.schedule();
  }

  schedule() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, RENDER_MS);
  }

  render() {
    const hw = this.transport.state === 'active' && this.engine.mode === 'user';
    if (!hw && !this.previewWanted) return;
    draw(this.canvas, buildModel(this.engine, this.palette, this.lastAction, Date.now()));
    if (hw) {
      this.frame = this.canvas.toPushFrame(); // fresh buffer: the previous one may still be in flight
      this.transport.send(this.frame);
    }
    if (this.previewWanted) this.sendPreview();
  }

  sendPreview() {
    const now = Date.now();
    const wait = PREVIEW_MS - (now - this.lastPreview);
    if (wait > 0) {
      if (!this.previewTimer) this.previewTimer = setTimeout(() => ((this.previewTimer = null), this.render()), wait);
      return;
    }
    this.lastPreview = now;
    this.onPreview(this.canvas.toPNG().toString('base64'), { state: this.transport.state, detail: this.transport.detail });
  }

  async shutdown() {
    this.stopKeepalive();
    await this.transport.close();
  }
}

module.exports = { DisplayManager };
