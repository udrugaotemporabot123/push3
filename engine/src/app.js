'use strict';
// Wires engine + MIDI ports + editor server + (optionally) Max for Live.
// Runs inside Node for Max (node.script in the M4L device) or standalone: `node p3um-main.js`.

const { Engine } = require('./engine');
const { MidiIO } = require('./midi-io');
const { createServer } = require('./server');
const store = require('./store');
const push3 = require('./push3');
const { DEFAULT_PALETTE } = require('./palette');
const { DisplayManager } = require('./display/manager');
const { loadAddons } = require('../../addons');

const VERSION = '0.18.0';
const EDITOR_PORT = Number(process.env.P3UM_PORT) || 47391;
const VIRTUAL_PORT = process.env.P3UM_VIRTUAL || 'Push3 UM';

function tryRequire(name) {
  try {
    return require(name);
  } catch (e) {
    return null;
  }
}

const max = tryRequire('max-api');

function start() {
  let server = null;
  const recentLog = [];

  function log(level, msg) {
    const line = `[p3um] ${level}: ${msg}`;
    if (max) max.post(line);
    else console.log(line);
    recentLog.push({ level, msg, at: Date.now() });
    if (recentLog.length > 200) recentLog.shift();
    if (server) server.broadcast({ t: 'log', level, msg });
  }

  function monitor(dir, bytes) {
    if (server && server.hasMonitor()) server.broadcast({ t: 'midi', dir, bytes: [...bytes] }, (c) => c.monitor);
  }

  let midi = null;
  const palette = DEFAULT_PALETTE.slice();
  const paletteReader = createPaletteReader();

  const io = {
    toPush(bytes) {
      if (midi) midi.toPush(bytes);
      monitor('push-out', bytes);
    },
    toHost(bytes) {
      if (midi) midi.toHost(bytes);
      monitor('host-out', bytes);
    },
    toLive(obj) {
      if (max) max.outlet('live', JSON.stringify(obj)).catch(() => {});
    },
    log,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    loadAddonState: (id) => store.loadAddonState(id),
    saveAddonState: (id, data) => store.saveAddonState(id, data),
  };

  const engine = new Engine(io, store.load(log));
  engine.setPalette(palette); // same array; filled with the real Push palette once read
  const addons = loadAddons(log);
  engine.setAddons(addons);
  const addonInfo = addons.map((a) => ({ id: a.id, name: a.name, description: a.description, actions: a.actions }));
  const display = new DisplayManager({
    engine,
    palette,
    log,
    onPreview: (png, transport) => server && server.broadcast({ t: 'display', png, transport }, (c) => c.display),
  });
  const updatePreviewWanted = () => display.setPreview(!!server && server.some((c) => c.display));

  // ---- Max device UI status -----------------------------------------------------------
  function deviceStatus() {
    if (!max) return;
    const s = engine.snapshot();
    const text = !s.pushConnected ? 'Push 3 not found' : s.mode === 'user' ? `USER MODE - ${engine.config.pages[s.page].name}` : 'Ready (Live Mode)';
    max.outlet('status', text).catch(() => {});
  }

  engine.onChange((what, data) => {
    if (!server) return;
    switch (what) {
      case 'led':
        server.broadcast({ t: 'led', ...data });
        break;
      case 'input':
        server.broadcast({ t: 'input', ...data });
        break;
      case 'value':
        server.broadcast({ t: 'value', ...data });
        break;
      case 'discovered':
        server.broadcast({ t: 'discovered', entry: data });
        break;
      case 'config':
        server.broadcast({ t: 'config', config: engine.config });
        break;
      case 'live':
        server.broadcast({ t: 'live', liveState: engine.liveState });
        break;
      case 'notice':
        server.broadcast({ t: 'log', level: 'info', msg: data.text });
        break;
      case 'status':
      case 'page':
        server.broadcast({ t: 'status', snapshot: engine.snapshot() });
        deviceStatus();
        break;
      default:
        break;
    }
  });

  function hello() {
    return {
      t: 'hello',
      version: VERSION,
      virtualPort: VIRTUAL_PORT,
      configFile: store.FILE,
      controls: push3.controls,
      palette,
      config: engine.config,
      snapshot: engine.snapshot(),
      presets: safe(() => store.listPresets(), []),
      ports: midi && midi.lastPortList,
      log: recentLog.slice(-50),
      inMax: !!max,
      addons: addonInfo,
    };
  }

  function onClientMessage(msg, client) {
    switch (msg.t) {
      case 'setConfig':
        engine.setConfig(msg.config);
        store.save(engine.config, log);
        break;
      case 'resetConfig':
        engine.setConfig(require('./config').defaultConfig());
        store.save(engine.config, log);
        break;
      case 'setPage':
        engine.setPage(Number(msg.page));
        break;
      case 'addPage': {
        const cfgMod = require('./config');
        const cfg = JSON.parse(JSON.stringify(engine.config));
        if (cfg.pages.length >= cfgMod.MAX_PAGES) break;
        const index = cfg.pages.length;
        const src = Number.isInteger(msg.duplicate) ? cfg.pages[msg.duplicate] : null;
        const page = src ? { ...JSON.parse(JSON.stringify(src)), name: `${src.name} copy`.slice(0, 24), channel: 0 } : cfgMod.defaultPage(index);
        cfg.pages.push(page);
        engine.setConfig(cfg);
        engine.setPage(index);
        store.save(engine.config, log);
        break;
      }
      case 'monitor':
        client.monitor = !!msg.on;
        break;
      case 'display':
        client.display = !!msg.on;
        updatePreviewWanted();
        break;
      case 'savePreset':
        store.savePreset(msg.name, engine.config);
        server.broadcast({ t: 'presets', presets: store.listPresets() });
        break;
      case 'loadPreset':
        engine.setConfig(store.loadPreset(msg.name));
        store.save(engine.config, log);
        break;
      case 'deletePreset':
        store.deletePreset(msg.name);
        server.broadcast({ t: 'presets', presets: store.listPresets() });
        break;
      case 'health':
        client.ws.send(JSON.stringify({ t: 'health', health: { ...engine.snapshot().health, pushConnected: engine.pushConnected, mode: engine.mode, virtualPort: !!(midi && midi.hostOut), ports: midi && midi.lastPortList, inMax: !!max } }));
        break;
      case 'clearDiscovered':
        engine.discovered.clear();
        server.broadcast({ t: 'status', snapshot: engine.snapshot() });
        break;
      default:
        break;
    }
  }

  // ---- Real palette from the Push (sysex 0x04), one entry at a time --------------------
  function createPaletteReader() {
    let index = -1;
    let timer = null;
    function request() {
      if (timer) clearTimeout(timer);
      if (index < 0 || index > 127) return;
      io.toPush([...push3.SYSEX_HEADER, 0x04, index, 0xf7]);
      timer = setTimeout(() => {
        index = -1; // Push did not answer: keep the default palette
      }, 300);
    }
    return {
      start() {
        index = 0;
        request();
      },
      handle(bytes) {
        const h = push3.SYSEX_HEADER;
        if (index < 0 || bytes[0] !== 0xf0 || bytes[h.length] !== 0x04 || bytes.length < h.length + 10) return;
        const a = bytes.slice(h.length + 1);
        const i = a[0];
        const rgb = [a[1] | (a[2] << 7), a[3] | (a[4] << 7), a[5] | (a[6] << 7)];
        palette[i] = rgb.map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
        index = i + 1;
        if (index > 127) {
          index = -1;
          if (timer) clearTimeout(timer);
          if (server) server.broadcast({ t: 'palette', palette });
          log('info', 'Read colour palette from Push');
        } else request();
      },
    };
  }

  // ---- Start: editor server first; its port doubles as a single-instance lock ---------
  let started = false;
  server = createServer({
    port: EDITOR_PORT,
    onClientMessage,
    getHello: hello,
    log,
    onReady: (ok) => bootMidi(ok),
    onClientGone: () => updatePreviewWanted(),
  });

  function bootMidi(ok) {
    if (started) return;
    started = true;
    if (!ok) {
      log('error', `Another Push3 User Mode instance seems to be running (port ${EDITOR_PORT} busy). This instance stays idle.`);
      if (max) max.outlet('status', 'Idle: another instance is running').catch(() => {});
      return;
    }
    midi = new MidiIO({
      virtualName: VIRTUAL_PORT,
      log,
      onPush(bytes) {
        monitor('push-in', bytes);
        paletteReader.handle(bytes);
        engine.handlePushMessage(bytes);
      },
      onHost(bytes) {
        if (bytes[0] < 0xf8) monitor('host-in', bytes);
        engine.handleHostMessage(bytes);
      },
      onPushConnection(connected) {
        engine.setPushConnected(connected);
        if (connected) setTimeout(() => paletteReader.start(), 300);
        deviceStatus();
      },
    });
    midi.start();
    deviceStatus();
  }

  // ---- Max handlers ------------------------------------------------------------------
  if (max) {
    max.addHandler('liveState', (json) => {
      try {
        engine.handleLiveState(JSON.parse(json));
      } catch (e) {
        log('warn', `bad liveState: ${e.message}`);
      }
    });
    max.addHandler('bridgeReady', () => {
      engine.health.bridgeReady = true;
      engine.syncVariationTargets();
    });
    max.addHandler('page', (n) => engine.setPage(Number(n) - 1));
    max.addHandler('editorUrl', () => max.outlet('editorUrl', `http://127.0.0.1:${EDITOR_PORT}/`).catch(() => {}));
  }

  // ---- Clean shutdown: give Live its MPE setting back ---------------------------------
  let stopped = false;
  function shutdown() {
    if (stopped) return;
    stopped = true;
    try {
      display.shutdown();
      engine.exitUserMode('shutdown');
      if (midi) midi.stop();
    } catch (e) {
      /* exiting anyway */
    }
  }
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
  process.on('exit', shutdown);
  process.on('uncaughtException', (e) => log('error', `uncaught: ${e.stack || e.message}`));

  return { engine, io, get midi() { return midi; }, server };
}

function safe(fn, dflt) {
  try {
    return fn();
  } catch (e) {
    return dflt;
  }
}

module.exports = { start, VERSION };
