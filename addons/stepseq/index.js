'use strict';
// Step sequencer add-on: a grid of step pads (lanes x steps) that plays notes on the page's
// MIDI channel in time with Live's MIDI clock. Each lane plays one note (e.g. a Drum Rack pad).
//   step  – a step pad: press toggles the step (velocity = how hard you hit), Shift + press clears the lane
//   play  – start/stop this sequence (it also needs Live's transport running)
//   clear – clear the whole sequence
//   hit   – a drum pad: plays its lane's note right away and selects the lane; while recording (and
//           Live is playing) the hit is written into the nearest step. Shift + hit clears the lane.
//   rec   – record on/off for live hits
// Hold a step pad and turn encoder 1 = velocity, 2 = chance, 3 = note length (gate); a step that
// was on is removed on release only if no encoder was turned.
//   pattern – pattern slot A–H: switches at the end of the loop (at once when stopped); Shift = copy the
//           current pattern into the slot; hold one pattern and press another = chain (A→B→C… in turn)
//   mod   – hold + press a step pad: length (loop ends on that step), euclid (spread N hits of the
//           selected lane evenly over the loop), chance (cycle the step's probability 100/75/50/25 %);
//           double: one press copies the loop to the next steps and doubles the loop length
// A step pad with lane "selected" edits the lane chosen with the last hit (Push-style drum sequencer:
// 16 drum pads + 32 steps of the selected lane). Swing (MPC style, 50 = straight) is set on Play.
// Live setup: Settings > MIDI > Output "Push3 UM": Sync ON (clock), and a MIDI track with
// MIDI From = "Push3 UM" (the page's channel) and the Drum Rack on it.

const TICKS_PER_STEP = 6; // 16th notes at 24 ppqn
const GATE_TICKS = 3;
const MAX_GATE = 96; // 4 beats
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
const CHANCES = [100, 75, 50, 25];
const SLOTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const slotOf = (v) => (SLOTS.includes(String(v || '').toUpperCase()) ? String(v).toUpperCase() : 'A');
const MOD_COLORS = { length: 45, euclid: 9, chance: 13, double: 21 };
const MOD_MODES = Object.keys(MOD_COLORS);
// Euclidean rhythm: k hits spread as evenly as possible over n steps, starting on step 1.
const euclid = (k, n) => Array.from({ length: n }, (_, i) => (i * k) % n < k);
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
    pattern: {
      label: 'Pattern (A–H)',
      fields: {
        seq: { label: 'Sekvenca', default: 'A' },
        slot: { label: 'Pattern', default: 'A', help: 'A–H; pritisak = prebaci na kraju loopa, Shift = kopiraj trenutni u ovaj' },
      },
    },
    mod: {
      label: 'Modifikator koraka',
      fields: {
        seq: { label: 'Sekvenca', default: 'A' },
        mode: { label: 'Način', default: 'length', help: 'length = drži + korak: duljina loopa; euclid = drži + korak N: N udaraca ravnomjerno; chance = drži + korak: vjerojatnost; double = udvostruči loop' },
      },
    },
  },

  create(api) {
    // seqs[name] = { running, length, pos, lanes: { lane: { note, channel, steps: [velocity...] } } }
    const saved = (api.loadState && api.loadState('stepseq')) || {};
    const seqs = {};
    let tick = 0;
    let transport = false;
    const pending = []; // note offs: { at, channel, note }
    const heldHits = new Map(); // control id -> [channel, note] of a held drum pad (its note off goes there)
    let saveTimer = null;

    const seqOf = (name) => {
      const key = name || 'A';
      if (!seqs[key]) {
        const old = saved[key] || {};
        seqs[key] = { running: old.running !== false, length: 0, loop: int(old.loop, 0), mod: null, pos: -1, lastBase: -1, stepTick: 0, swing: 0, recording: false, selected: old.selected || null, lanes: {}, savedLanes: old.lanes || {}, pattern: slotOf(old.pattern), queued: null, chain: Array.isArray(old.chain) ? old.chain.filter((x) => SLOTS.includes(x)) : [], heldPattern: null, patterns: old.patterns && typeof old.patterns === 'object' ? old.patterns : {} };
      }
      return seqs[key];
    };

    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const out = {};
        for (const [k, sq] of Object.entries(seqs)) {
          out[k] = { running: sq.running, selected: sq.selected, loop: sq.loop, pattern: sq.pattern, patterns: sq.patterns, chain: sq.chain, lanes: {} };
          for (const [lane, l] of Object.entries(sq.lanes)) out[k].lanes[lane] = { steps: l.steps, chance: l.chance, gate: l.gate };
        }
        if (api.saveState) api.saveState('stepseq', out);
      }, 500);
      if (saveTimer.unref) saveTimer.unref();
    };

    const noteOn = (l, vel, gate = GATE_TICKS) => {
      // A retrigger ends the previous note first, so its late note off cannot cut the new one.
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].channel === l.channel && pending[i].note === l.note) {
          api.sendHost([0x90 | l.channel, l.note, 0]);
          pending.splice(i, 1);
        }
      }
      api.sendHost([0x90 | l.channel, l.note, vel]);
      pending.push({ at: tick + gate, channel: l.channel, note: l.note });
    };
    const heldSteps = new Map(); // control id -> { sq, lane, i, removeOnRelease, turned }

    const laneOf = (sq, lane) => {
      const key = String(lane || '1');
      return sq.lanes[key === 'selected' ? sq.selected : key];
    };

    function registerLane(sq, lane, note, ctx) {
      if (!sq.lanes[lane]) {
        const savedSteps = sq.savedLanes[lane] && Array.isArray(sq.savedLanes[lane].steps) ? sq.savedLanes[lane].steps : [];
        const saved = sq.savedLanes[lane] || {};
        sq.lanes[lane] = { note, channel: ctx ? ctx.channel : 0, steps: savedSteps.slice(0, 64), chance: Array.isArray(saved.chance) ? saved.chance.slice(0, 64) : [], gate: Array.isArray(saved.gate) ? saved.gate.slice(0, 64) : [], skip: -1 };
      }
      sq.lanes[lane].note = note;
      if (ctx) sq.lanes[lane].channel = ctx.channel;
      if (!sq.selected || !sq.lanes[sq.selected]) sq.selected = lane;
    }

    // Steps that play: the loop length if set (and not longer than the steps there are), else all.
    const loopLen = (sq) => (sq.loop > 0 && sq.loop < sq.length ? sq.loop : sq.length);

    function applyMod(sq, l, i) {
      const n = loopLen(sq);
      if (sq.mod === 'length') sq.loop = i + 1 >= sq.length ? 0 : i + 1;
      else if (sq.mod === 'euclid' && l) {
        const hits = euclid(Math.min(i + 1, n), n);
        for (let s = 0; s < n; s++) l.steps[s] = hits[s] ? l.steps[s] || 100 : 0;
      } else if (sq.mod === 'chance' && l && l.steps[i]) {
        const cur = CHANCES.indexOf(l.chance[i] || 100);
        l.chance[i] = CHANCES[(cur + 1) % CHANCES.length];
        if (l.chance[i] === 100) l.chance[i] = 0; // 0 = always (keeps the saved file small)
      }
    }

    function double(sq) {
      const n = loopLen(sq);
      if (n * 2 > sq.length) return api.log('info', `Sekvencer: nema mjesta za udvostručenje (${n} od ${sq.length} koraka)`);
      for (const l of Object.values(sq.lanes)) {
        for (let s = 0; s < n; s++) {
          l.steps[s + n] = l.steps[s] || 0;
          l.chance[s + n] = l.chance[s] || 0;
        }
      }
      sq.loop = n * 2 >= sq.length ? 0 : n * 2;
    }

    // A live hit while recording goes into the step that is closest in time; if that is the coming step,
    // the step is skipped once so the hit is not played twice.
    function recordHit(sq, l, vel) {
      if (!sq.recording || !transport || !sq.running || !sq.length || sq.pos < 0) return;
      const late = tick - sq.stepTick >= TICKS_PER_STEP / 2;
      const i = late ? (sq.pos + 1) % loopLen(sq) : sq.pos;
      l.steps[i] = vel;
      if (late) l.skip = i;
    }

    // Patterns: the current one lives in the lanes; the others are snapshots in sq.patterns.
    const snapshot = (sq) => {
      const lanes = { ...((sq.patterns[sq.pattern] && sq.patterns[sq.pattern].lanes) || {}) };
      for (const [lane, l] of Object.entries(sq.lanes)) lanes[lane] = { steps: l.steps.slice(), chance: l.chance.slice(), gate: l.gate.slice() };
      return { loop: sq.loop, lanes };
    };
    const hasNotes = (pat) => !!pat && Object.values(pat.lanes || {}).some((l) => (l.steps || []).some((v) => v > 0));

    function switchPattern(sq, slot) {
      if (slot === sq.pattern) return;
      sq.patterns[sq.pattern] = snapshot(sq);
      const next = sq.patterns[slot] || { loop: sq.loop, lanes: {} };
      for (const [lane, l] of Object.entries(sq.lanes)) {
        const src = next.lanes[lane] || {};
        l.steps = Array.isArray(src.steps) ? src.steps.slice(0, 64) : [];
        l.chance = Array.isArray(src.chance) ? src.chance.slice(0, 64) : [];
        l.gate = Array.isArray(src.gate) ? src.gate.slice(0, 64) : [];
        l.skip = -1;
      }
      sq.loop = int(next.loop, 0);
      sq.pattern = slot;
      delete sq.patterns[slot];
      persist();
    }

    function playStep(sq) {
      if (sq.pos + 1 >= loopLen(sq)) {
        // Loop end: a queued pattern wins, otherwise the chain moves on.
        let next = sq.queued;
        if (!next && sq.chain.length > 1) next = sq.chain[(sq.chain.indexOf(sq.pattern) + 1) % sq.chain.length];
        if (next && next !== sq.pattern) {
          switchPattern(sq, next);
          sq.pos = -1;
        }
        sq.queued = null;
      }
      sq.pos = (sq.pos + 1) % Math.max(1, loopLen(sq));
      sq.stepTick = tick;
      for (const l of Object.values(sq.lanes)) {
        const vel = l.steps[sq.pos] || 0;
        if (l.skip === sq.pos) {
          l.skip = -1;
          continue;
        }
        if (!vel) continue;
        if (l.chance[sq.pos] && Math.random() * 100 >= l.chance[sq.pos]) continue;
        noteOn(l, vel, l.gate[sq.pos] || GATE_TICKS);
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

      press({ params, action, velocity, shift, id }) {
        const sq = seqOf(params.seq);
        const vel = Math.max(1, Math.min(127, velocity || 100));
        if (action === 'play') sq.running = !sq.running;
        else if (action === 'rec') sq.recording = !sq.recording;
        else if (action === 'pattern') {
          const slot = slotOf(params.slot);
          if (shift) {
            if (slot !== sq.pattern) sq.patterns[slot] = snapshot(sq);
          } else if (sq.heldPattern && sq.heldPattern !== slot) {
            const a = SLOTS.indexOf(sq.heldPattern);
            const b = SLOTS.indexOf(slot);
            sq.chain = SLOTS.slice(Math.min(a, b), Math.max(a, b) + 1);
            if (b < a) sq.chain.reverse();
          } else {
            sq.heldPattern = slot;
            sq.chain = [];
            if (transport && sq.running && slot !== sq.pattern) sq.queued = sq.queued === slot ? null : slot;
            else {
              sq.queued = null;
              switchPattern(sq, slot);
            }
          }
        }
        else if (action === 'mod') {
          const mode = MOD_MODES.includes(params.mode) ? params.mode : 'length';
          if (mode === 'double') double(sq);
          else sq.mod = mode;
        }
        else if (action === 'clear') for (const l of Object.values(sq.lanes)) l.steps = [];
        else if (action === 'hit') {
          const lane = String(params.lane || '1');
          const l = sq.lanes[lane];
          if (!l) return;
          sq.selected = lane;
          if (shift) l.steps = [];
          else {
            const prev = heldHits.get(id);
            if (prev) api.sendHost([0x90 | prev[0], prev[1], 0]);
            heldHits.set(id, [l.channel, l.note]);
            api.sendHost([0x90 | l.channel, l.note, vel]);
            recordHit(sq, l, vel);
          }
        } else if (action === 'step') {
          const l = laneOf(sq, params.lane);
          if (sq.mod) applyMod(sq, l, int(params.step, 1) - 1);
          else if (!l) return;
          else if (shift) l.steps = [];
          else {
            const i = int(params.step, 1) - 1;
            const wasOn = !!l.steps[i];
            if (!wasOn) {
              l.steps[i] = vel;
              l.chance[i] = 0;
              l.gate[i] = 0;
            }
            heldSteps.set(id, { sq, l, i, removeOnRelease: wasOn, turned: false });
          }
        }
        persist();
        api.renderAddons();
      },

      // Encoders while a step is held: 1 velocity, 2 chance, 3 gate. Returns true = encoder consumed.
      turn({ id, encoder, delta }) {
        const h = heldSteps.get(id);
        if (!h) return false;
        const { l, i } = h;
        if (!l.steps[i]) l.steps[i] = 100;
        if (encoder === 'enc.1') l.steps[i] = Math.max(1, Math.min(127, Math.round(l.steps[i] + delta)));
        else if (encoder === 'enc.2') {
          const cur = l.chance[i] || 100;
          const next = Math.max(5, Math.min(100, Math.round((cur + delta * 5) / 5) * 5));
          l.chance[i] = next >= 100 ? 0 : next;
        } else if (encoder === 'enc.3') l.gate[i] = Math.max(1, Math.min(MAX_GATE, Math.round((l.gate[i] || GATE_TICKS) + delta)));
        else return false;
        h.turned = true;
        persist();
        api.renderAddons();
        return true;
      },

      release({ params, action, id }) {
        if (action === 'pattern') {
          const sq = seqOf(params.seq);
          if (sq.heldPattern === slotOf(params.slot)) sq.heldPattern = null;
          persist();
          api.renderAddons();
          return;
        }
        if (action === 'step') {
          const h = heldSteps.get(id);
          heldSteps.delete(id);
          if (h && h.removeOnRelease && !h.turned) {
            h.l.steps[h.i] = 0;
            persist();
            api.renderAddons();
          }
          return;
        }
        if (action === 'mod') {
          const sq = seqOf(params.seq);
          if (sq.mod === params.mode || (sq.mod === 'length' && !MOD_MODES.includes(params.mode))) sq.mod = null;
          api.renderAddons();
          return;
        }
        if (action !== 'hit') return;
        const h = heldHits.get(id);
        if (!h) return;
        heldHits.delete(id);
        api.sendHost([0x90 | h[0], h[1], 0]);
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
            const next = (sq.pos + 1) % loopLen(sq);
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
        for (const h of heldSteps.values()) {
          if (h.sq !== sq || !h.l.steps[h.i]) continue;
          const gate = h.l.gate[h.i] || GATE_TICKS;
          return `Korak ${h.i + 1}: vel ${h.l.steps[h.i]} · ${h.l.chance[h.i] || 100}% · dužina ${+(gate / 6).toFixed(2)}×1/16 (enk. 1–3)`;
        }
        const playing = transport && sq.running;
        const parts = [`Seq ${params.seq || 'A'} ${playing ? '▶' : '■'} ${playing && sq.pos >= 0 ? sq.pos + 1 : '–'}/${loopLen(sq)}`];
        if (sq.mod) parts.push(`[${sq.mod}]`);
        if (sq.pattern !== 'A' || sq.queued || Object.keys(sq.patterns).length) parts.push(`pat ${sq.pattern}${sq.queued ? `→${sq.queued}` : ''}${sq.chain.length > 1 ? ` (${sq.chain.join('')})` : ''}`);
        if (sq.selected && Object.keys(sq.lanes).length > 1) parts.push(`traka ${sq.selected}`);
        if (sq.recording) parts.push('● REC');
        return parts.join(' ');
      },

      led({ params, action, held }) {
        const sq = seqOf(params.seq);
        if (held) return { color: 3, anim: 0 };
        if (action === 'play') return { color: sq.running ? 21 : 23, anim: 0 };
        if (action === 'clear') return { color: 7, anim: 0 };
        if (action === 'pattern') {
          const slot = slotOf(params.slot);
          if (slot === sq.pattern) return { color: 21, anim: 0 };
          if (slot === sq.queued) return { color: 21, anim: api.ANIM.blink || 0 };
          if (sq.chain.includes(slot)) return { color: 22, anim: 0 };
          return { color: hasNotes(sq.patterns[slot]) ? 23 : 0, anim: 0 };
        }
        if (action === 'mod') return { color: sq.mod === params.mode ? 3 : MOD_COLORS[params.mode] || MOD_COLORS.length, anim: 0 };
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
        if (i >= loopLen(sq)) return { color: 0, anim: 0 }; // outside the loop
        const on = !!l.steps[i];
        if (transport && sq.running && sq.pos === i) return { color: on ? 3 : 2, anim: 0 }; // playhead
        if (on && l.chance[i]) return { color: veryDim(color) - 1, anim: 0 }; // plays only sometimes
        return { color: on ? color : veryDim(color), anim: 0 };
      },
    };
  },
};
