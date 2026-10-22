# Writing an add-on

Add-ons are optional modules in `addons/<name>/index.js`. They add new actions that controls can be
mapped to in the editor (Function → *Add-on*). Every call into an add-on is wrapped in `try/catch`
by the engine: a bug in an add-on disables that control, never the core. Users can switch add-ons
off in Settings.

## Shape

```js
module.exports = {
  id: 'myaddon',                 // unique, \w only
  name: 'My add-on',             // shown in the editor
  description: 'What it does',
  actions: {
    doThing: {
      label: 'Do the thing',
      fields: {                  // free-text parameters edited per control
        track: { label: 'Track', default: 'selected', help: 'name, number or selected' },
      },
    },
  },
  create(api) {
    return {
      watch(params, action, ctx) { return [/* Live specs to observe */]; },
      press({ params, action, id, velocity, shift }) {},
      release({ params, action, id }) {},
      led({ params, action, id, held }) { return { color: 21, anim: 0 }; },
      status({ params, action }) { return 'Seq A ▶ 5/16'; }, // short text on the display status line
      clock(type) {},            // 'start' | 'clock' (24 ppqn) | 'stop' | 'continue' – needs Sync on Push3 UM out
    };
  },
};
```

All hooks are optional. `watch` is called for every control mapped to your add-on whenever the
configuration changes; `ctx` is `{ page, id, channel }` (the MIDI channel that page sends on).
`status` is called by the display (30 fps, keep it cheap) once per add-on instance on the current page
(instances are told apart by `params.seq` / `params.track` / `params.source`); an empty string hides it.
Display buttons mapped to an add-on show the action's `label`.

## API

| | |
|---|---|
| `api.toLive(cmd)` | send a command to the Live API bridge (see below) |
| `api.liveValue(spec)` | latest observed value for a spec: `{ ok, value, name, display, color, track }` |
| `api.liveKey(spec)` | stable key of a spec |
| `api.sendHost(bytes)` | send raw MIDI to Live through the virtual port |
| `api.pageChannel(page?)` | MIDI channel (0–15) of a page |
| `api.renderAddons()` | redraw the LEDs of all add-on controls (e.g. after internal state changed) |
| `api.loadState(id)` / `api.saveState(id, data)` | small persistent JSON state per add-on |
| `api.log(level, msg)` | log to the editor / Max console |
| `api.ANIM` | LED animation channels (`pulse`, `blink`, …) |
| `api.SLOT` | clip slot states: `EMPTY 0, STOPPED 1, PLAYING 2, RECORDING 3, TRIGGERED 4` |

### Specs you can observe (`watch`) and their values

| spec | value |
|---|---|
| `{ t: 'trackProp', track, prop: 'mute' \| 'solo' \| 'arm' }` | 0/1, `name`, `color` |
| `{ t: 'trackSelect', track }` | 1 if selected |
| `{ t: 'song', prop: 'is_playing' \| 'session_record' \| 'metronome' \| 'arrangement_overdub' }` | 0/1 |
| `{ t: 'param', target: 'volume' \| 'pan' \| 'send' \| 'macro' \| 'deviceParam' \| 'named' \| 'tempo', track, index, device, param }` | 0..1, `name`, `display` |
| `{ t: 'slot', track, scene }` | slot state |
| `{ t: 'trackSlots', track }` | array of slot states |

`track` is `selected`, a track number (`"1"`) or a track name. Racks: `first`, a name or `#2`.

### Commands (`toLive`)

- `{ cmd: 'liveSet', key, spec, value }` – set a switch (0/1) or parameter (0..1)
- `{ cmd: 'liveCall', spec, fn }` with `fn`:
  `fireSlot`, `deleteSlot` (spec `slot`), `stopTrack`, `select` (spec `trackSelect`), `fire` (spec `{ t: 'scene', index }`),
  `play`, `stop`, `tap`, `undo`, `redo`, `capture`, `trackPrev/Next`, `scenePrev/Next`, `devicePrev/Next`,
  `clipToPad` (spec `{ t: 'clipToPad', source, scene, target, rack, pad: 'next' | 'selected' }`).
- Bridge notices (`{ type: 'notice', text }`) are shown on the display and in the log.

## Testing

Add tests in `engine/test/addons.test.js` (see the Looper, Sampler and Step sequencer tests): build an
engine with your add-on, feed `handlePushMessage` / `handleLiveState` / `handleHostMessage`, and
assert on what was sent to Live, to the host port and to the Push.
