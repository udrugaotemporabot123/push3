'use strict';
// Local HTTP + WebSocket server for the editor (127.0.0.1 only).

const http = require('http');
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

function createServer({ port, onClientMessage, getHello, log, onReady }) {
  const server = http.createServer((req, res) => {
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
  });

  const clients = new Set();
  const WS = loadWs();
  if (WS) {
    const wss = new WS.WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => {
      const client = { ws, monitor: false };
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
      ws.on('close', () => clients.delete(client));
      ws.on('error', () => clients.delete(client));
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

  return {
    broadcast,
    send,
    hasMonitor: () => [...clients].some((c) => c.monitor),
    close: () => server.close(),
  };
}

module.exports = { createServer };
