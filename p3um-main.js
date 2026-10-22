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

// The display module is optional: if it is missing (e.g. after updating from an older
// version), ask Max to run "npm install" once per version, never in a loop.
if (!missing) {
  try {
    require.resolve('usb');
  } catch (e) {
    const fs = require('fs');
    const marker = require('path').join(__dirname, 'node_modules', `.p3um-usb-install-${require('./package.json').version}`);
    if (!fs.existsSync(marker)) {
      try {
        fs.writeFileSync(marker, String(Date.now()));
        missing = 'usb';
      } catch (e2) {
        /* read-only folder: run without the display */
      }
    }
  }
}

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
