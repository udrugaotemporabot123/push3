'use strict';
// HTTP + WebSocket server for the editor. Always on 127.0.0.1; optionally (opt-in) also on the local
// network for a tablet, protected by a secret token. WebSocket connections from web pages of other
// sites are refused (a page you visit must not be able to drive your Push).

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const EDITOR_DIR = path.join(__dirname, '..', '..', 'editor');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function loadWs() {
  try {
    return require('ws');
  } catch (e) {
    return null;
  }
}

const COOKIE = 'p3um_k';

function parseQuery(url) {
  const out = {};
  const q = String(url || '').split('?')[1] || '';
  for (const part of q.split('&')) {
    const [k, v] = part.split('=');
    if (k) out[k] = decodeURIComponent(v || '');
  }
  return out;
}

function cookieValue(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

// Constant-time compare so the token cannot be guessed by timing.
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function localOriginOk(origin, port) {
  if (!origin) return true; // not a browser page (or Max's jweb with a file origin)
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function createServer({ port, lanPort, onClientMessage, getHello, log, onReady, onClientGone }) {
  let lanToken = null;
  let lanServer = null;

  const lanAuthorized = (req) => sameToken(parseQuery(req.url).k, lanToken) || sameToken(cookieValue(req, COOKIE), lanToken);

  const handler = (lan) => (req, res) => {
    if (lan && !lanAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Push 3 User Mode: otvori link iz editora na računalu (Postavke → Pristup s tableta).');
      return;
    }
    if (lan && parseQuery(req.url).k) res.setHeader('Set-Cookie', `${COOKIE}=${lanToken}; HttpOnly; SameSite=Strict; Path=/`);
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.normalize(path.join(EDITOR_DIR, rel));
    if (!file.startsWith(EDITOR_DIR)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  };
  const server = http.createServer(handler(false));

  const clients = new Set();
  const WS = loadWs();
  let wss = null;
  const upgrade = (lan) => (req, socket, head) => {
    const okPath = (req.url || '').split('?')[0] === '/ws';
    const origin = req.headers.origin;
    const ok = okPath && (lan ? lanAuthorized(req) && (!origin || origin === `http://${req.headers.host}`) : localOriginOk(origin, port));
    if (!ok || !wss) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      if (okPath && wss) log('warn', `Editor: refused a connection from ${origin || 'unknown origin'}`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, lan));
  };
  if (WS) {
    wss = new WS.WebSocketServer({ noServer: true });
    server.on('upgrade', upgrade(false));
    wss.on('connection', (ws, lan) => {
      const client = { ws, monitor: false, lan: !!lan };
      clients.add(client);
      send(client, getHello());
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch (e) {
          return;
        }
        try {
          onClientMessage(msg, client);
        } catch (e) {
          log('error', `editor message failed: ${e.message}`);
        }
      });
      const drop = () => {
        clients.delete(client);
        if (onClientGone) onClientGone(client);
      };
      ws.on('close', drop);
      ws.on('error', drop);
    });
  } else log('error', 'WebSocket module "ws" is not installed; the editor cannot connect');

  function send(client, msg) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  }

  function broadcast(msg, filter) {
    if (!clients.size) return;
    const data = JSON.stringify(msg);
    for (const c of clients) {
      if (filter && !filter(c)) continue;
      if (c.ws.readyState === 1) c.ws.send(data);
    }
  }

  // The port doubles as a single-instance lock: if it is taken, another engine is running.
  server.on('error', (e) => {
    log('error', `Editor server: ${e.message}`);
    if (onReady) onReady(false, e);
  });
  server.listen(port, '127.0.0.1', () => {
    log('info', `Editor at http://127.0.0.1:${port}/`);
    if (onReady) onReady(true);
  });

  // LAN access (opt-in): a second listener on all interfaces that needs the token.
  function setLan(enabled, token) {
    lanToken = token || null;
    if (enabled && lanToken && !lanServer && lanPort) {
      lanServer = http.createServer(handler(true));
      lanServer.on('upgrade', upgrade(true));
      lanServer.on('error', (e) => {
        log('error', `LAN editor: ${e.message}`);
        lanServer = null;
      });
      lanServer.listen(lanPort, '0.0.0.0', () => log('info', `Editor on the local network: port ${lanPort}`));
    } else if (!enabled && lanServer) {
      lanServer.close();
      lanServer = null;
      for (const c of clients) if (c.lan) c.ws.close();
    }
  }

  function lanInfo() {
    return {
      enabled: !!lanServer,
      urls: lanServer && lanToken ? lanAddresses().map((ip) => `http://${ip}:${lanPort}/?k=${lanToken}`) : [],
    };
  }

  return {
    setLan,
    lanInfo,
    broadcast,
    send,
    hasMonitor: () => [...clients].some((c) => c.monitor),
    some: (pred) => [...clients].some(pred),
    close: () => {
      server.close();
      if (lanServer) lanServer.close();
    },
  };
}

module.exports = { createServer, localOriginOk, sameToken };
