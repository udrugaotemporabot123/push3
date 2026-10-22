'use strict';
// Entry point. Loaded by node.script inside Push3UserMode.amxd, or run directly:
//   node p3um-main.js
// If the dependencies are missing, tell the Max device so it can run `npm install`.

let missing = null;
for (const dep of ['@julusian/midi', 'ws']) {
  try {
    require.resolve(dep);
  } catch (e) {
    missing = dep;
    break;
  }
}

// The display module ("usb") is optional and never installed automatically: it has no ready-made
// macOS binary and compiling it on the user's Mac could hang "Installing components" for ever.
// The MIDI modules ship with the release (node_modules in the download).

if (missing) {
  let max = null;
  try {
    max = require('max-api');
  } catch (e) {
    /* standalone */
  }
  const msg = `Missing dependency "${missing}". Run "npm install" in this folder.`;
  if (max) {
    max.post(msg);
    max.outlet('needsInstall', 1);
    max.outlet('status', 'Installing components...');
  } else {
    console.error(msg);
    process.exitCode = 1;
  }
} else {
  require('./engine/src/app').start();
}
