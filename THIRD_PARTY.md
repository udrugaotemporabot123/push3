# Third-party notices

- **Inter** typeface by Rasmus Andersson (SIL Open Font License 1.1). Glyph bitmaps in
  `engine/src/display/font.json` are rendered from Inter by `tools/build_font.py`.
- **Push LED colour palette** values (`engine/src/palette.js`) as published in the open-source
  DrivenByMoss project by Jürgen Moßgraber (LGPL-3.0); hardware data, credited here.
- **Push 2 MIDI and Display Interface Manual**, Ableton AG (github.com/Ableton/push-interface):
  protocol reference for MIDI modes, LEDs, sysex and display frames.
- **QR Code Generator for JavaScript** by Kazuhiko Arase (MIT), vendored as `editor/vendor/qrcode.js`
  for the tablet link. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
- **push3-max-lab** by Cardamien (github.com/Cardamien/push3-max-lab, MIT / CC BY 4.0): the finding that a
  Max for Live device can draw on the Push 3 screen by sending `jit_matrix` to `live.push` (used by
  `p3um-screen.js`; no code copied).
- Runtime npm dependencies: `@julusian/midi` (MIT, RtMidi), `ws` (MIT), `usb` (MIT, optional).

Ableton, Push and Live are trademarks of Ableton AG. This project is not affiliated with Ableton.
