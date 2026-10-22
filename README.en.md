# Push 3 User Mode → a real MIDI controller

A Max for Live device + editor that turns Ableton **Push 3 User Mode** into a fully configurable
MIDI controller, in the spirit of Novation Components / Launchpad Pro custom modes, plus a lot of
Live-aware extras. *(Hrvatski: [README.md](README.md))*

## Highlights

- **Every pad, button, encoder, jog wheel and the touch strip** is configurable in a visual editor.
- **Clean MIDI**: entering User Mode switches the pads from MPE to poly aftertouch automatically and
  restores Push's setting when you leave. Everything goes out on the channel you choose (per page) on a
  virtual port **`Push3 UM`**.
- **Momentary / toggle / trigger**, radio groups, up to 4 extra messages per button, velocity curves,
  encoder modes (absolute with feedback, 14-bit absolute CC pairs, relative, up/down steps), Shift + encoder = fine.
- **Colours and animations** (pulse/blink) for on and off states.
- **Two-way feedback**: LEDs and encoder values follow Live through the virtual port.
- **Pages (up to 16)** selected with the upper display buttons, **shift layer** per control,
  **hold-to-show page**.
- **Live-aware controls without MIDI mapping** (via the Live API): track mute/solo/arm/select with
  track colours, transport, scenes, clip slots (launch/record/delete with state LEDs), navigation,
  rack variations (several racks at once), mixer and device parameters with real names and values on the display,
  touch strip / pad pressure → Live parameters.
- **Display**: its own 960×160 layout (page names, encoder names + values, last action, transport),
  per-page "controls" or "big" view, live preview in the editor, experimental takeover of the Push 3
  display while in User Mode.
- **Templates**: Keyboard (scale, Push-style in-key layout, octave/semitone transpose buttons), Mixer, Selected device, Sends, Selected track (macros + variations), Variations
  (8 racks × 8), Clip grid, Transport, Looper, Sampler, Step sequencer.
- **Add-ons** (optional, can't crash the core): Live Looper, Sampler (record → straight into the next
  empty Simpler of a Drum Rack), Step sequencer (lanes × steps on Live's clock, drum pads, live recording, swing, Euclid, chance, patterns), XY FX (pad grid as an XY surface for two effect parameters).
- **Editor from a tablet** (opt-in, token-protected link on the local network); the local editor refuses connections from other websites.
- Presets, import/export, copy/paste, undo/redo, MIDI monitor, setup check, rotating backups.

## Install

1. Download the repository and keep the folder intact, e.g. in
   `~/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/Push3UserMode/`.
2. Drop **`Push3UserMode.amxd`** on any track (the Main track is a good place: it passes audio through).
3. On first run the device installs its Node modules (`npm install`, ~30 s, needs internet).
4. Live → Settings → Link, Tempo & MIDI:
   - **Ableton Push 3 User Port** (in and out): Track **off**, Remote **off**: this device owns it.
   - **Push3 UM** in: Track on (play instruments with the pads), Remote on (MIDI mapping).
   - **Push3 UM** out: Remote on (feedback), Sync on (only for the sequencer / tempo-synced LED animations).
5. Open the editor with the **Editor** button on the device (or **Browser** → http://127.0.0.1:47391/).
   *Settings → Setup check* tells you what works and what to switch on.

Press **User** on Push to enter User Mode; press it again to go back.

## Requirements

macOS, Ableton Live 12 Suite (Max for Live), Push 3 connected to the computer. Tested logic with
automated tests; hardware-tested by the author on a Push 3.

## Development

```
npm install
npm test            # engine, display, Live API bridge (fake LOM), add-ons, whole-app smoke test
npm start           # run the engine without Live: http://127.0.0.1:47391/
python3 tools/build_device.py   # regenerate the .amxd / .maxpat
```

- `engine/src/engine.js` – the core (pure logic, injected I/O)
- `engine/src/push3.js` – Push 3 control map (confirmed numbers; `verify: true` = unconfirmed)
- `p3um-live.js` – Live API bridge running in Max's `[js]`
- `editor/` – the web editor
- `addons/` – optional modules, see [docs/ADDONS.md](docs/ADDONS.md)

Versions: every release is a branch `release/vX.Y.Z` (see [CHANGELOG.md](CHANGELOG.md)).

## License

MIT. See [THIRD_PARTY.md](THIRD_PARTY.md) for fonts and references. Not affiliated with Ableton.
