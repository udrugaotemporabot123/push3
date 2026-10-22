'use strict';
// Smoke test of the whole app as a separate process: editor HTTP, WebSocket hello,
// config edit saved to disk, clean exit. MIDI hardware is absent here, which must not crash it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..', '..');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function waitFor(fn, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      /* retry */
    }
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('app starts, serves the editor, accepts a config and saves it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3um-'));
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['p3um-main.js'], { cwd: ROOT, env: { ...process.env, P3UM_DIR: dir, P3UM_PORT: String(port) }, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  try {
    const page = await waitFor(() => get(port, '/').then((r) => r.status === 200 && r));
    assert.ok(page.body.includes('Push 3'));
    assert.notEqual((await get(port, '/../package.json')).status, 200); // no access outside editor/
    assert.equal((await get(port, '/%E0')).status, 400); // malformed URL is answered, not left hanging

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const hello = await new Promise((resolve, reject) => {
      ws.on('message', (m) => {
        const msg = JSON.parse(m.toString());
        if (msg.t === 'hello') resolve(msg);
      });
      ws.on('error', reject);
    });
    assert.ok(hello.controls.length > 100);
    assert.ok(hello.addons.some((a) => a.id === 'looper'));
    const cfg = hello.config;
    cfg.pages[0].name = 'Saved OK';
    ws.send(JSON.stringify({ t: 'setConfig', config: cfg }));
    const file = path.join(dir, 'config.json');
    await waitFor(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).pages[0].name === 'Saved OK');

    // A web page from another site must not get in.
    const foreign = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: 'http://evil.example' } });
    await assert.rejects(new Promise((resolve, reject) => (foreign.on('open', resolve), foreign.on('error', reject))));

    // LAN access is off until switched on from the computer; then it needs the token.
    const lanPort = port + 1;
    await assert.rejects(get(lanPort, '/'));
    const lanMsg = new Promise((resolve) => ws.on('message', (m) => JSON.parse(m.toString()).t === 'lan' && resolve(JSON.parse(m.toString()).lan)));
    ws.send(JSON.stringify({ t: 'lan', on: true }));
    assert.equal((await lanMsg).enabled, true);
    const token = JSON.parse(fs.readFileSync(path.join(dir, 'lan.json'), 'utf8')).token;
    assert.ok(token.length >= 12);
    await waitFor(() => get(lanPort, '/').then((r) => r.status === 401));
    assert.equal((await get(lanPort, '/?k=wrong-token-123')).status, 401);
    assert.equal((await get(lanPort, '/?k=%E0')).status, 401);
    assert.equal((await get(lanPort, `/?k=${token}`)).status, 200);
    const tablet = new WebSocket(`ws://127.0.0.1:${lanPort}/ws?k=${token}`);
    const tabletHello = await new Promise((resolve, reject) => {
      tablet.on('message', (m) => JSON.parse(m.toString()).t === 'hello' && resolve(true));
      tablet.on('error', reject);
    });
    assert.ok(tabletHello);
    const noKey = new WebSocket(`ws://127.0.0.1:${lanPort}/ws`);
    await assert.rejects(new Promise((resolve, reject) => (noKey.on('open', resolve), noKey.on('error', reject))));
    tablet.send(JSON.stringify({ t: 'lan', on: false })); // the tablet cannot switch it off
    ws.send(JSON.stringify({ t: 'lan', on: false }));
    await waitFor(() => get(lanPort, '/').then(() => false, () => true));
    ws.close();
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
  }
  assert.ok(!/uncaught/i.test(stderr), stderr);
});
