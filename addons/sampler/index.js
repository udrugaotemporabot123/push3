'use strict';
// Sampler add-on: live sampling straight onto drum pads.
//   sampleToPad    – press: record on the source track (next empty slot); press again: stop and load the
//                    recording into the next empty Simpler of the Drum Rack on the target track
//   lastToPad      – load the last clip of the source track into the next empty pad
//   lastToSelected – load the last clip of the source track into the Drum Rack's selected pad
// Preparation: put a Drum Rack on the target track with empty Simplers on the pads you want to fill.

const SLOT = { EMPTY: 0, STOPPED: 1, PLAYING: 2, RECORDING: 3, TRIGGERED: 4 };
const TRACK_FIELDS = {
  source: { label: 'Snima s tracka', default: 'selected', help: 'Audio track koji snima (npr. mic in - sampling): ime, broj ili selected' },
  target: { label: 'Drum Rack na tracku', default: 'selected', help: 'Track s Drum Rackom: ime, broj ili selected' },
  rack: { label: 'Drum Rack', default: 'first', help: 'first ili ime Drum Racka' },
};

module.exports = {
  id: 'sampler',
  name: 'Sampler',
  description: 'Live sampling na padove: snimi zvuk i odmah ga stavi na sljedeći prazni Simpler u Drum Racku.',
  actions: {
    sampleToPad: { label: 'Snimi → sljedeći pad', fields: { ...TRACK_FIELDS, autoArm: { label: 'Auto arm', default: 'yes' } } },
    lastToPad: { label: 'Zadnji clip → sljedeći pad', fields: TRACK_FIELDS },
    lastToSelected: { label: 'Zadnji clip → odabrani pad', fields: TRACK_FIELDS },
  },

  create(api) {
    const slotsSpec = (p) => ({ t: 'trackSlots', track: p.source || 'selected' });
    const armSpec = (p) => ({ t: 'trackProp', track: p.source || 'selected', prop: 'arm' });
    const slots = (p) => {
      const v = api.liveValue(slotsSpec(p));
      return v && v.ok && Array.isArray(v.value) ? v.value : null;
    };
    const lastWithClip = (s) => {
      for (let i = s.length - 1; i >= 0; i--) if (s[i] !== SLOT.EMPTY && s[i] !== SLOT.RECORDING) return i;
      return -1;
    };
    const load = (p, slotIndex, pad) =>
      api.toLive({ cmd: 'liveCall', spec: { t: 'clipToPad', source: p.source || 'selected', scene: slotIndex + 1, target: p.target || 'selected', rack: p.rack || 'first', pad }, fn: 'clipToPad' });
    const fire = (p, slotIndex) => api.toLive({ cmd: 'liveCall', spec: { t: 'slot', track: p.source || 'selected', scene: slotIndex + 1 }, fn: 'fireSlot' });

    return {
      watch(params, action) {
        return action === 'sampleToPad' ? [slotsSpec(params), armSpec(params)] : [slotsSpec(params)];
      },

      press({ params, action }) {
        const s = slots(params);
        if (!s) return api.log('warn', 'Sampler: izvorni track još nije povezan');
        if (action === 'sampleToPad') {
          const rec = s.indexOf(SLOT.RECORDING);
          if (rec >= 0) {
            fire(params, rec); // stop recording
            load(params, rec, 'next'); // the bridge waits until the file is ready
            return;
          }
          let next = s.indexOf(SLOT.EMPTY);
          if (next < 0) return api.log('warn', 'Sampler: nema praznog slota na izvornom tracku');
          const arm = api.liveValue(armSpec(params));
          if (params.autoArm !== 'no' && !(arm && arm.value)) api.toLive({ cmd: 'liveSet', key: api.liveKey(armSpec(params)), spec: armSpec(params), value: 1 });
          fire(params, next);
        } else {
          const last = lastWithClip(s);
          if (last < 0) return api.log('warn', 'Sampler: nema clipa na izvornom tracku');
          load(params, last, action === 'lastToSelected' ? 'selected' : 'next');
        }
      },

      led({ params, action, held }) {
        if (held) return { color: 3, anim: 0 };
        const s = slots(params);
        if (!s) return { color: 0, anim: 0 };
        if (action === 'sampleToPad') return s.includes(SLOT.RECORDING) ? { color: 5, anim: api.ANIM.blink } : { color: 50, anim: 0 };
        return { color: lastWithClip(s) >= 0 ? 49 : 0, anim: 0 };
      },
    };
  },
};
