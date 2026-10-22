'use strict';
// Sends frames to the Push 3 display over USB (bulk endpoint 1 of interface 0).
// Live owns this interface while it drives the display; claiming fails in that case and we
// report 'busy' instead of fighting Live for it.

const { FRAME_HEADER } = require('./canvas');

const VENDOR = 0x2982;
const PUSH3 = 0x1969;
const INTERFACE = 0;
const ENDPOINT = 1;
const SEND_TIMEOUT_MS = 400; // a frame that takes longer means the USB link is contended: give up

class UsbTransport {
  constructor(log) {
    this.log = log;
    this.state = 'closed'; // closed | opening | active | busy | unavailable | error
    this.detail = '';
    this.device = null;
    this.sending = false;
    this.disabled = false; // set after a timeout/error: no more tries until the engine restarts
  }

  async open() {
    if (this.state === 'active' || this.state === 'opening') return this.state;
    if (this.disabled) return this.set('busy', 'Ekran isključen nakon greške (sigurnost); restartaj device za novi pokušaj');
    let usbLib;
    try {
      usbLib = require('usb');
    } catch (e) {
      return this.set('unavailable', 'USB modul nije instaliran (npm install)');
    }
    this.state = 'opening';
    let device = null;
    try {
      device = await usbLib.usb.findDeviceByIds(VENDOR, PUSH3);
      if (!device) return this.set('unavailable', 'Push 3 USB uređaj nije pronađen');
      await device.open();
      await device.claimInterface(INTERFACE);
      this.device = device;
      return this.set('active', 'Ekran preuzet');
    } catch (e) {
      try {
        if (device && device.opened) await device.close();
      } catch (e2) {
        /* ignore */
      }
      return this.set('busy', `Live drži ekran (${e.message})`);
    }
  }

  async close() {
    const d = this.device;
    this.device = null;
    if (!d) {
      if (this.state !== 'closed') this.set('closed', '');
      return;
    }
    try {
      await d.releaseInterface(INTERFACE);
    } catch (e) {
      /* ignore */
    }
    try {
      await d.close();
    } catch (e) {
      /* ignore */
    }
    this.set('closed', 'Ekran vraćen Liveu');
  }

  // Drops the frame if the previous one is still in flight (the display only needs the latest).
  async send(frame) {
    if (this.state !== 'active' || this.sending || !this.device) return false;
    this.sending = true;
    let timer = null;
    try {
      // Safety: if a frame does not go out quickly, Live is probably fighting for the display.
      // Hand the display back at once and stop trying for this session.
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`USB ne odgovara ${SEND_TIMEOUT_MS} ms`)), SEND_TIMEOUT_MS);
      });
      await Promise.race([
        (async () => {
          await this.device.transferOut(ENDPOINT, FRAME_HEADER);
          await this.device.transferOut(ENDPOINT, frame);
        })(),
        timeout,
      ]);
      return true;
    } catch (e) {
      this.disabled = true;
      this.set('error', `Ekran vraćen Liveu (sigurnost): ${e.message}`);
      await this.close();
      return false;
    } finally {
      clearTimeout(timer);
      this.sending = false;
    }
  }

  set(state, detail) {
    this.state = state;
    this.detail = detail;
    this.log(state === 'active' || state === 'closed' ? 'info' : 'warn', `Display: ${detail || state}`);
    return state;
  }
}

module.exports = { UsbTransport };
