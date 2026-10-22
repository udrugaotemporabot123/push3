'use strict';
// Step sequencer add-on: a grid of step pads (lanes x steps) that plays notes on the page's
// MIDI channel in time with Live's MIDI clock. Each lane plays one note (e.g. a Drum Rack pad).
//   step  – a step pad: press toggles the step (velocity = how hard you hit), Shift + press clears the lane
//   play  – start/stop this sequence (it also needs Live's transport running)
//   clear – clear the whole sequence
// Live setup: Settings > MIDI > Output "Push3 UM": Sync ON (clock), and a MIDI track with
// MIDI From = "Push3 UM" (the page's channel) and the Drum Rack on it.

const TICKS_PER_STEP = 6; // 16th notes at 24 ppqn
const GATE_TICKS = 3;
const LANE_COLORS = [5, 9, 13, 21, 33, 45, 49, 57, 17, 29, 37, 53, 41, 25, 61, 7];
const veryDim = (c) => c - ((c - 4) % 4) + 3; // palette groups of four: bright, full, dim, very dim

module.exports = {
  id: 'stepseq',
  name: 'Step sekvencer',
  description: 'Mreža koraka na padovima (trake × koraci) koja svira note u tempu Livea, npr. za Drum Rack sa samplovima.',
  actions: {
    step: {
      label: 'Korak',
      fields: {
        seq: { label: 'Sekvenca', default: 'A', help: 'Ime sekvence (više sekvenci = više imena)' },
        lane: { label: 'Traka', default: '1' },
        step: { label: 'Korak', default: '1' },
        note: { label: 'Nota trake', default: '36', help: 'Nota koju traka svira (Drum Rack: 36 = C1)' },
      },
    },
    play: { label: 'Play / Stop sekvence', fields: { seq: { label: 'Sekvenca', default: 'A' } } },
    clear: { label: 'Obriši sekvencu', fields: { seq: { label: 'Sekvenca', default: 'A' } } },
  },

  create(api) {
    // seqs[name] = { running, length, pos, lanes: { lane: { note, channel, steps: [velocity...] } } }
    const saved = (api.loadState && api.loadState('stepseq')) || {};
    const seqs = {};
    let tick = 0;
    let transport = false;
    const pending = []; // note offs: { at, channel, note }
    let saveTimer = null;

    const seqOf = (name) => {
      const key = name || 'A';
      if (!seqs[key]) {
        const old = saved[key] || {};
        seqs[key] = { running: old.running !== false, length: 0, pos: -1, lanes: {}, savedLanes: old.lanes || {} };
      }
      return seqs[key];
    };

    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const out = {};
        for (const [k, sq] of Object.entries(seqs)) {
          out[k] = { running: sq.running, lanes: {} };
          for (const [lane, l] of Object.entries(sq.lanes)) out[k].lanes[lane] = { steps: l.steps };
        }
        if (api.saveState) api.saveState('stepseq', out);
      }, 500);
      if (saveTimer.unref) saveTimer.unref();
    };

    function playStep(sq) {
      sq.pos = (sq.pos + 1) % Math.max(1, sq.length);
      for (const l of Object.values(sq.lanes)) {
        const vel = l.steps[sq.pos] || 0;
        if (!vel) continue;
        api.sendHost([0x90 | l.channel, l.note, vel]);
        pending.push({ at: tick + GATE_TICKS, channel: l.channel, note: l.note });
      }
    }

    function flushNoteOffs(all = false) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        if (all || p.at <= tick) {
          api.sendHost([0x90 | p.channel, p.note, 0]);
          pending.splice(i, 1);
        }
      }
    }

    return {
      // Called for every mapping at config time: registers lanes/steps so the sequence knows its layout.
      watch(params, action, ctx) {
        if (action !== 'step') return [];
        const sq = seqOf(params.seq);
        const lane = String(params.lane || '1');
        const step = Math.max(1, Math.min(64, Number.parseInt(params.step, 10) || 1));
        const note = Math.max(0, Math.min(127, Number.parseInt(params.note, 10) || 36));
        if (!sq.lanes[lane]) {
          const savedSteps = sq.savedLanes[lane] && Array.isArray(sq.savedLanes[lane].steps) ? sq.savedLanes[lane].steps : [];
          sq.lanes[lane] = { note, channel: ctx ? ctx.channel : 0, steps: savedSteps.slice(0, 64) };
        }
        sq.lanes[lane].note = note;
        if (ctx) sq.lanes[lane].channel = ctx.channel;
        sq.length = Math.max(sq.length, step);
        return [];
      },

      press({ params, action, velocity, shift }) {
        const sq = seqOf(params.seq);
        if (action === 'play') sq.running = !sq.running;
        else if (action === 'clear') for (const l of Object.values(sq.lanes)) l.steps = [];
        else if (action === 'step') {
          const l = sq.lanes[String(params.lane || '1')];
          if (!l) return;
          if (shift) l.steps = [];
          else {
            const i = (Number.parseInt(params.step, 10) || 1) - 1;
            l.steps[i] = l.steps[i] ? 0 : Math.max(1, Math.min(127, velocity || 100));
          }
        }
        persist();
        api.renderAddons();
      },

      clock(type) {
        if (type === 'start') {
          transport = true;
          tick = 0;
          for (const sq of Object.values(seqs)) sq.pos = -1;
        } else if (type === 'continue') transport = true;
        else if (type === 'stop') {
          transport = false;
          flushNoteOffs(true);
          api.renderAddons();
        } else if (type === 'clock' && transport) {
          if (tick % TICKS_PER_STEP === 0) {
            for (const sq of Object.values(seqs)) if (sq.running && sq.length) playStep(sq);
            api.renderAddons();
          }
          tick++;
          flushNoteOffs();
        }
      },

      led({ params, action, held }) {
        const sq = seqOf(params.seq);
        if (held) return { color: 3, anim: 0 };
        if (action === 'play') return { color: sq.running ? 21 : 23, anim: 0 };
        if (action === 'clear') return { color: 7, anim: 0 };
        const laneKey = String(params.lane || '1');
        const l = sq.lanes[laneKey];
        if (!l) return { color: 0, anim: 0 };
        const i = (Number.parseInt(params.step, 10) || 1) - 1;
        const color = LANE_COLORS[(Number.parseInt(laneKey, 10) - 1 + 64) % LANE_COLORS.length];
        const on = !!l.steps[i];
        if (transport && sq.running && sq.pos === i) return { color: on ? 3 : 2, anim: 0 }; // playhead
        return { color: on ? color : veryDim(color), anim: 0 };
      },
    };
  },
};
