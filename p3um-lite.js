'use strict';
// Entry point of the Lite device (Push3UserModeLite.amxd): a plain MIDI controller.
// No Live API bridge, add-ons, display rendering or animation clock: as little CPU as possible.
// Only the two MIDI modules are needed; if they are missing, Max runs `npm install` once.

let missing = null;
for (const dep of ['@julusian/midi', 'ws']) {
  try {
    require.resolve(dep);
  } catch (e) {
    missing = dep;
    break;
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
  require('./engine/src/app').start({ lite: true });
}
