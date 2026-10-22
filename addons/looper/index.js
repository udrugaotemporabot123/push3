'use strict';
// Live Looper add-on: loop recording per track on single buttons/pads.
//   recNext   – record into the next empty clip slot; press again to close the loop (it keeps playing)
//   undoLast  – delete the last clip on the track (the most recent loop)
//   playStop  – stop the track if something plays, otherwise play its last clip
//   arm       – arm/disarm the track (feedback)

const SLOT = { EMPTY: 0, STOPPED: 1, PLAYING: 2, RECORDING: 3, TRIGGERED: 4 };

module.exports = {
  id: 'looper',
  name: 'Live Looper',
  description: 'Snimanje loopova po tracku jednim gumbom: snimi u sljedeći prazni slot, zatvori loop, poništi, play/stop.',
  actions: {
    recNext: {
      label: 'Snimi sljedeći loop',
      fields: {
        track: { label: 'Track', default: 'selected', help: 'selected, broj ili ime tracka' },
        bars: { label: 'Taktova', default: '', help: 'prazno = slobodno (drugi pritisak zatvara loop); broj = snima točno toliko taktova i sam zatvori loop' },
        autoArm: { label: 'Auto arm', default: 'yes', help: 'yes = armaj track prije snimanja' },
      },
    },
    undoLast: { label: 'Poništi zadnji loop', fields: { track: { label: 'Track', default: 'selected' } } },
    playStop: { label: 'Play / Stop tracka', fields: { track: { label: 'Track', default: 'selected' } } },
    arm: { label: 'Arm tracka', fields: { track: { label: 'Track', default: 'selected' } } },
  },

  create(api) {
    const slotsSpec = (p) => ({ t: 'trackSlots', track: p.track || 'selected' });
    const armSpec = (p) => ({ t: 'trackProp', track: p.track || 'selected', prop: 'arm' });
    const slots = (p) => {
      const v = api.liveValue(slotsSpec(p));
      return v && v.ok && Array.isArray(v.value) ? v.value : null;
    };
    const lastWithClip = (s) => {
      for (let i = s.length - 1; i >= 0; i--) if (s[i] !== SLOT.EMPTY) return i;
      return -1;
    };
    const fire = (p, index, bars) => {
      const cmd = { cmd: 'liveCall', spec: { t: 'slot', track: p.track || 'selected', scene: index + 1 }, fn: 'fireSlot' };
      if (bars) cmd.recordBars = bars;
      api.toLive(cmd);
    };
    const barsOf = (p) => {
      const n = Number.parseInt(p.bars, 10);
      return n > 0 && n <= 64 ? n : 0;
    };

    return {
      watch(params, action) {
        return action === 'arm' ? [armSpec(params)] : [slotsSpec(params), armSpec(params)];
      },

      press({ params, action }) {
        if (action === 'arm') {
          const v = api.liveValue(armSpec(params));
          api.toLive({ cmd: 'liveSet', key: api.liveKey(armSpec(params)), spec: armSpec(params), value: v && v.value ? 0 : 1 });
          return;
        }
        const s = slots(params);
        if (!s) return;
        if (action === 'recNext') {
          const rec = s.indexOf(SLOT.RECORDING);
          if (rec >= 0) return fire(params, rec); // close the loop: Live keeps playing it
          let next = lastWithClip(s) + 1;
          if (next >= s.length) next = s.indexOf(SLOT.EMPTY);
          if (next < 0) return api.log('warn', 'Looper: nema praznog slota na tracku');
          const arm = api.liveValue(armSpec(params));
          if (params.autoArm !== 'no' && !(arm && arm.value)) api.toLive({ cmd: 'liveSet', key: api.liveKey(armSpec(params)), spec: armSpec(params), value: 1 });
          fire(params, next, barsOf(params));
        } else if (action === 'undoLast') {
          const last = lastWithClip(s);
          if (last >= 0) api.toLive({ cmd: 'liveCall', spec: { t: 'slot', track: params.track || 'selected', scene: last + 1 }, fn: 'deleteSlot' });
        } else if (action === 'playStop') {
          if (s.some((x) => x === SLOT.PLAYING || x === SLOT.RECORDING)) api.toLive({ cmd: 'liveCall', spec: { t: 'trackSelect', track: params.track || 'selected' }, fn: 'stopTrack' });
          else {
            const last = lastWithClip(s);
            if (last >= 0) fire(params, last);
          }
        }
      },

      led({ params, action, held }) {
        if (held) return { color: 3, anim: 0 };
        if (action === 'arm') {
          const v = api.liveValue(armSpec(params));
          return { color: v && v.value ? 5 : 7, anim: 0 };
        }
        const s = slots(params);
        if (!s) return { color: 0, anim: 0 };
        const recording = s.includes(SLOT.RECORDING);
        const playing = s.includes(SLOT.PLAYING);
        const hasClips = lastWithClip(s) >= 0;
        if (action === 'recNext') return recording ? { color: 5, anim: api.ANIM.blink } : { color: 6, anim: 0 };
        if (action === 'undoLast') return { color: hasClips ? 9 : 0, anim: 0 };
        if (action === 'playStop') return playing ? { color: 21, anim: api.ANIM.pulse } : { color: hasClips ? 23 : 0, anim: 0 };
        return { color: 0, anim: 0 };
      },
    };
  },
};
