'use strict';
// MIDI ports: the Push 3 User Port (in/out) and a virtual port pair towards Live.
// Ports are re-scanned every couple of seconds, so unplugging/replugging the Push or
// restarting Live never needs a restart of this engine.

const PUSH_PORT_PATTERNS = [/push 3.*user/i, /user.*push 3/i, /midiin2 \(ableton push 3\)/i, /midiout2 \(ableton push 3\)/i];
const SCAN_INTERVAL_MS = 2000;

function loadMidi() {
  try {
    return require('@julusian/midi');
  } catch (e) {
    return null;
  }
}

function findPort(port, patterns) {
  const n = port.getPortCount();
  for (let i = 0; i < n; i++) {
    const name = port.getPortName(i);
    if (patterns.some((p) => p.test(name))) return { index: i, name };
  }
  return null;
}

function listPorts(port) {
  const out = [];
  for (let i = 0; i < port.getPortCount(); i++) out.push(port.getPortName(i));
  return out;
}

class MidiIO {
  /**
   * @param {object} opts { virtualName, onPush(bytes), onHost(bytes), onPushConnection(bool, info), log(level,msg) }
   */
  constructor(opts) {
    this.opts = opts;
    this.midi = loadMidi();
    this.pushIn = null;
    this.pushOut = null;
    this.pushName = null;
    this.hostIn = null;
    this.hostOut = null;
    this.timer = null;
  }

  get available() {
    return !!this.midi;
  }

  start() {
    if (!this.midi) {
      this.opts.log('error', 'MIDI module @julusian/midi is not installed');
      return false;
    }
    this.openVirtual();
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.closePush();
    for (const p of [this.hostIn, this.hostOut]) {
      try {
        if (p) p.closePort();
      } catch (e) {
        /* already closed */
      }
    }
    this.hostIn = this.hostOut = null;
  }

  openVirtual() {
    const name = this.opts.virtualName;
    try {
      this.hostOut = new this.midi.Output();
      this.hostOut.openVirtualPort(name);
      this.hostIn = new this.midi.Input();
      // Receive sysex? no. Timing (clock)? yes, for LED animations. Active sensing: no.
      this.hostIn.ignoreTypes(true, false, true);
      this.hostIn.on('message', (dt, msg) => this.opts.onHost(msg));
      this.hostIn.openVirtualPort(name);
      this.opts.log('info', `Virtual MIDI port "${name}" ready`);
    } catch (e) {
      this.opts.log('error', `Could not create virtual port "${name}": ${e.message}`);
    }
  }

  scan() {
    try {
      // One long-lived pair of unopened ports just for listing (creating MIDI clients on
      // every scan would leak CoreMIDI clients).
      if (!this.probeIn) this.probeIn = new this.midi.Input();
      if (!this.probeOut) this.probeOut = new this.midi.Output();
      const inPort = findPort(this.probeIn, PUSH_PORT_PATTERNS);
      const outPort = findPort(this.probeOut, PUSH_PORT_PATTERNS);
      this.lastPortList = { inputs: listPorts(this.probeIn), outputs: listPorts(this.probeOut) };

      const connected = !!(this.pushIn && this.pushOut);
      if (inPort && outPort && !connected) this.openPush(inPort, outPort);
      else if ((!inPort || !outPort) && connected) {
        this.opts.log('warn', 'Push 3 User Port disappeared');
        this.closePush();
        this.opts.onPushConnection(false);
      }
    } catch (e) {
      this.opts.log('error', `Port scan failed: ${e.message}`);
    }
  }

  openPush(inPort, outPort) {
    try {
      this.pushIn = new this.midi.Input();
      this.pushIn.ignoreTypes(false, true, true); // we need sysex (mode replies), not clock/sensing
      this.pushIn.on('message', (dt, msg) => this.opts.onPush(msg));
      this.pushIn.openPort(inPort.index);
      this.pushOut = new this.midi.Output();
      this.pushOut.openPort(outPort.index);
      this.pushName = inPort.name;
      this.opts.log('info', `Connected to ${inPort.name}`);
      this.opts.onPushConnection(true, { input: inPort.name, output: outPort.name });
    } catch (e) {
      this.opts.log('error', `Could not open Push 3 User Port: ${e.message}`);
      this.closePush();
    }
  }

  closePush() {
    for (const p of [this.pushIn, this.pushOut]) {
      try {
        if (p) p.closePort();
      } catch (e) {
        /* already closed */
      }
    }
    this.pushIn = this.pushOut = null;
    this.pushName = null;
  }

  toPush(bytes) {
    if (!this.pushOut) return;
    try {
      this.pushOut.sendMessage(bytes);
    } catch (e) {
      this.opts.log('error', `send to Push failed: ${e.message}`);
    }
  }

  toHost(bytes) {
    if (!this.hostOut) return;
    try {
      this.hostOut.sendMessage(bytes);
    } catch (e) {
      this.opts.log('error', `send to Live failed: ${e.message}`);
    }
  }
}

module.exports = { MidiIO, PUSH_PORT_PATTERNS };
