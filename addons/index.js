'use strict';
// Add-on registry. Each add-on lives in its own folder and exports:
//   { id, name, description, actions: { key: { label, fields: { name: { label, default, help } } } },
//     create(api) -> { watch(params, action) -> [spec], press(ctx), release(ctx), led(ctx) -> {color, anim} } }
// The engine wraps every call in try/catch: a broken add-on can never take the core down.

const fs = require('fs');
const path = require('path');

function loadAddons(log) {
  const out = [];
  for (const dir of fs.readdirSync(__dirname, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    try {
      const mod = require(path.join(__dirname, dir.name));
      if (mod && mod.id && typeof mod.create === 'function') out.push(mod);
    } catch (e) {
      log('error', `Add-on "${dir.name}" failed to load: ${e.message}`);
    }
  }
  return out;
}

module.exports = { loadAddons };
