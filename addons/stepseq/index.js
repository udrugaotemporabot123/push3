'use strict';
// Step sequencer add-on: a grid of step pads (lanes x steps) that plays notes on the page's
// MIDI channel in time with Live's MIDI clock. Each lane plays one note (e.g. a Drum Rack pad).
//   step  – a step pad: press toggles the step (velocity = how hard you hit), Shift + press clears the lane
//   play  – start/stop this sequence (it also needs Live's transport running)
//   clear – clear the whole sequence
//   hit   – a drum pad: plays its lane's note right away and selects the lane; while recording (and
//           Live is playing) the hit is written into the nearest step. Shift + hit clears the lane.
//   rec   – record on/off for live hits
// A step pad with lane "selected" edits the lane chosen with the last hit (Push-style drum sequencer:
// 16 drum pads + 32 steps of the selected lane). Swing (MPC style, 50 = straight) is set on Play.
// Live setup: Settings > MIDI > Output "Push3 UM": Sync ON (clock), and a MIDI track with
// MIDI From = "Push3 UM" (the page's channel) and the Drum Rack on it.

const TICKS_PER_STEP = 6; // 16th notes at 24 ppqn
const GATE_TICKS = 3;
const LANE_COLORS = [5, 9, 13, 21, 33, 45, 49, 57, 17, 29, 37, 53, 41, 25, 61, 7];
const veryDim = (c) => c - ((c - 4) % 4) + 3; // palette groups of four: bright, full, dim, very dim
const REC_ON = 5;
const REC_OFF = 7;
const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
// MPC-style swing percentage -> delay of every second 16th in clock ticks (24 ppqn: 6 ticks per 16th).
const swingTicks = (pct) => Math.max(0, Math.min(3, Math.round(((int(pct, 50) - 50) / 25) * 3)));
const laneColor = (lane) => LANE_COLORS[(int(lane, 1) - 1 + 64) % LANE_COLORS.length];

module.exports = {
  id: 'stepseq',
  name: 'Step sekvencer',
  description: 'Mreža koraka na padovima (trake × koraci) koja svira note u tempu Livea, npr. za Drum Rack sa samplovima.',
  actions: {
    step: {
      label: 'Korak',
      fields: {
        seq: { label: 'Sekvenca', default: 'A', help: 'Ime sekvence (više sekvenci = više imena)' },
        lane: { label: 'Traka', default: '1', help: 'broj trake ili selected = traka zadnjeg udarenog drum pada' },
        step: { label: 'Korak', default: '1' },
        note: { label: 'Nota trake', default: '36', help: 'Nota koju traka svira (Drum Rack: 36 = C1)' },
      },
    },
    hit: {
      label: 'Drum pad (svira + snima)',
      fields: {
        seq: { label: 'Sekvenca', default: 'A' },
        lane: { label: 'Traka', default: '1' },
        note: { label: 'Nota trake', default: '36' },
      },
    },
    rec: { label: 'Snimanje udaraca on/off', fields: { seq: { label: 'Sekvenca', default: 'A' } } },
    play: {
      label: 'Play / Stop sekvence',
      fields: {
        seq: { label: 'Sekvenca', default: 'A' },
        swing: { label: 'Swing %', default: '50', help: '50 = ravno, 58 = lagani, 66 = shuffle, 75 = maks' },
      },
    },
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
        seqs[key] = { running: old.running !== false, length: 0, pos: -1, lastBase: -1, stepTick: 0, swing: 0, recording: false, selected: old.selected || null, lanes: {}, savedLanes: old.lanes || {} };
      }
      return seqs[key];
    };

    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const out = {};
        for (const [k, sq] of Object.entries(seqs)) {
          out[k] = { running: sq.running, selected: sq.selected, lanes: {} };
          for (const [lane, l] of Object.entries(sq.lanes)) out[k].lanes[lane] = { steps: l.steps };
        }
        if (api.saveState) api.saveState('stepseq', out);
      }, 500);
      if (saveTimer.unref) saveTimer.unref();
    };

    const noteOn = (l, vel) => {
      api.sendHost([0x90 | l.channel, l.note, vel]);
      pending.push({ at: tick + GATE_TICKS, channel: l.channel, note: l.note });
    };

    const laneOf = (sq, lane) => {
      const key = String(lane || '1');
      return sq.lanes[key === 'selected' ? sq.selected : key];
    };

    function registerLane(sq, lane, note, ctx) {
      if (!sq.lanes[lane]) {
        const savedSteps = sq.savedLanes[lane] && Array.isArray(sq.savedLanes[lane].steps) ? sq.savedLanes[lane].steps : [];
        sq.lanes[lane] = { note, channel: ctx ? ctx.channel : 0, steps: savedSteps.slice(0, 64), skip: -1, held: 0 };
      }
      sq.lanes[lane].note = note;
      if (ctx) sq.lanes[lane].channel = ctx.channel;
      if (!sq.selected || !sq.lanes[sq.selected]) sq.selected = lane;
    }

    // A live hit while recording goes into the step that is closest in time; if that is the coming step,
    // the step is skipped once so the hit is not played twice.
    function recordHit(sq, l, vel) {
      if (!sq.recording || !transport || !sq.running || !sq.length || sq.pos < 0) return;
      const late = tick - sq.stepTick >= TICKS_PER_STEP / 2;
      const i = late ? (sq.pos + 1) % sq.length : sq.pos;
      l.steps[i] = vel;
      if (late) l.skip = i;
    }

    function playStep(sq) {
      sq.pos = (sq.pos + 1) % Math.max(1, sq.length);
      sq.stepTick = tick;
      for (const l of Object.values(sq.lanes)) {
        const vel = l.steps[sq.pos] || 0;
        if (l.skip === sq.pos) {
          l.skip = -1;
          continue;
        }
        if (!vel) continue;
        noteOn(l, vel);
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
        const sq = seqOf(params.seq);
        const lane = String(params.lane || '1');
        const note = Math.max(0, Math.min(127, int(params.note, 36)));
        if (action === 'play') sq.swing = swingTicks(params.swing);
        else if (action === 'hit') registerLane(sq, lane, note, ctx);
        else if (action === 'step') {
          if (lane !== 'selected') registerLane(sq, lane, note, ctx);
          sq.length = Math.max(sq.length, Math.max(1, Math.min(64, int(params.step, 1))));
        }
        return [];
      },

      press({ params, action, velocity, shift }) {
        const sq = seqOf(params.seq);
        const vel = Math.max(1, Math.min(127, velocity || 100));
        if (action === 'play') sq.running = !sq.running;
        else if (action === 'rec') sq.recording = !sq.recording;
        else if (action === 'clear') for (const l of Object.values(sq.lanes)) l.steps = [];
        else if (action === 'hit') {
          const lane = String(params.lane || '1');
          const l = sq.lanes[lane];
          if (!l) return;
          sq.selected = lane;
          if (shift) l.steps = [];
          else {
            l.held++;
            api.sendHost([0x90 | l.channel, l.note, vel]);
            recordHit(sq, l, vel);
          }
        } else if (action === 'step') {
          const l = laneOf(sq, params.lane);
          if (!l) return;
          if (shift) l.steps = [];
          else {
            const i = (Number.parseInt(params.step, 10) || 1) - 1;
            l.steps[i] = l.steps[i] ? 0 : vel;
          }
        }
        persist();
        api.renderAddons();
      },

      release({ params, action }) {
        if (action !== 'hit') return;
        const l = seqOf(params.seq).lanes[String(params.lane || '1')];
        if (!l || l.held <= 0) return;
        l.held--;
        api.sendHost([0x90 | l.channel, l.note, 0]);
      },

      clock(type) {
        if (type === 'start') {
          transport = true;
          tick = 0;
          for (const sq of Object.values(seqs)) {
            sq.pos = -1;
            sq.lastBase = -1;
          }
        } else if (type === 'continue') transport = true;
        else if (type === 'stop') {
          transport = false;
          flushNoteOffs(true);
          api.renderAddons();
        } else if (type === 'clock' && transport) {
          // Every second 16th is delayed by the swing ticks.
          let stepped = false;
          for (const sq of Object.values(seqs)) {
            if (!sq.running || !sq.length) continue;
            const next = (sq.pos + 1) % sq.length;
            const base = tick - (tick % TICKS_PER_STEP);
            if (base !== sq.lastBase && tick % TICKS_PER_STEP === (next % 2 ? sq.swing : 0)) {
              sq.lastBase = base;
              playStep(sq);
              stepped = true;
            }
          }
          if (stepped) api.renderAddons();
          tick++;
          flushNoteOffs();
        }
      },

      status({ params }) {
        const sq = seqOf(params.seq);
        if (!sq.length) return '';
        const playing = transport && sq.running;
        const parts = [`Seq ${params.seq || 'A'} ${playing ? '▶' : '■'} ${playing && sq.pos >= 0 ? sq.pos + 1 : '–'}/${sq.length}`];
        if (sq.selected && Object.keys(sq.lanes).length > 1) parts.push(`traka ${sq.selected}`);
        if (sq.recording) parts.push('● REC');
        return parts.join(' ');
      },

      led({ params, action, held }) {
        const sq = seqOf(params.seq);
        if (held) return { color: 3, anim: 0 };
        if (action === 'play') return { color: sq.running ? 21 : 23, anim: 0 };
        if (action === 'clear') return { color: 7, anim: 0 };
        if (action === 'rec') return { color: sq.recording ? REC_ON : REC_OFF, anim: sq.recording ? api.ANIM.pulse || 0 : 0 };
        const laneKey = String(params.lane || '1') === 'selected' ? sq.selected : String(params.lane || '1');
        const l = sq.lanes[laneKey];
        if (!l) return { color: 0, anim: 0 };
        const color = laneColor(laneKey);
        if (action === 'hit') {
          if (transport && sq.running && sq.pos >= 0 && l.steps[sq.pos]) return { color: 3, anim: 0 }; // lane plays now
          return { color: laneKey === sq.selected ? color : veryDim(color) - 1, anim: 0 };
        }
        const i = int(params.step, 1) - 1;
        const on = !!l.steps[i];
        if (transport && sq.running && sq.pos === i) return { color: on ? 3 : 2, anim: 0 }; // playhead
        return { color: on ? color : veryDim(color), anim: 0 };
      },
    };
  },
};
