'use strict';
// Sends frames to the Push 3 display over USB (bulk endpoint 1 of interface 0).
// Live owns this interface while it drives the display; claiming fails in that case and we
// report 'busy' instead of fighting Live for it.

const { FRAME_HEADER } = require('./canvas');

const VENDOR = 0x2982;
const PUSH3 = 0x1969;
const INTERFACE = 0;
const ENDPOINT = 1;

class UsbTransport {
  constructor(log) {
    this.log = log;
    this.state = 'closed'; // closed | opening | active | busy | unavailable | error
    this.detail = '';
    this.device = null;
    this.sending = false;
  }

  async open() {
    if (this.state === 'active' || this.state === 'opening') return this.state;
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
    try {
      await this.device.transferOut(ENDPOINT, FRAME_HEADER);
      await this.device.transferOut(ENDPOINT, frame);
      return true;
    } catch (e) {
      this.set('error', `Slanje na ekran nije uspjelo: ${e.message}`);
      await this.close();
      return false;
    } finally {
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
