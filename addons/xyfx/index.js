'use strict';
// XY FX add-on: the pad grid as an XY surface for two Live parameters (e.g. a filter's frequency
// and resonance, a delay's time and feedback). Column = X, row = Y. The LEDs draw a crosshair at the
// current values, which follow Live (also when you turn the knobs on screen).
//   xy – one pad of the surface; with "spring" the parameters return to where they were when you
//        let go of the last pad (momentary effect throws)

const COLORS = { line: 45, dot: 3, off: 0 };

const FIELDS = {
  track: { label: 'Track', default: 'selected', help: 'selected, broj ili ime tracka' },
  device: { label: 'Device', default: 'selected', help: 'ime devicea (traži i unutar rackova), first ili selected' },
  xParam: { label: 'X parametar', default: '1', help: 'ime ili broj parametra (npr. Frequency)' },
  yParam: { label: 'Y parametar', default: '2', help: 'ime ili broj parametra (npr. Resonance)' },
  col: { label: 'Stupac (X)', default: '1', help: '1–8' },
  row: { label: 'Red (Y)', default: '1', help: '1–8 (1 = dolje)' },
  size: { label: 'Veličina', default: '8', help: 'broj stupaca/redova površine (2–8)' },
  spring: { label: 'Vrati se', default: 'no', help: 'yes = kad pustiš, parametri se vrate na prijašnje vrijednosti' },
};

const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

module.exports = {
  id: 'xyfx',
  name: 'XY FX',
  description: 'Padovi kao XY površina za dva parametra efekta (stupac = X, red = Y), s križićem koji prati Live i opcijom povratka kad pustiš.',
  actions: { xy: { label: 'XY pad', fields: FIELDS } },

  create(api) {
    const spec = (p, axis) => ({ t: 'param', target: 'named', track: p.track || 'selected', device: p.device || 'selected', param: String((axis === 'x' ? p.xParam : p.yParam) || (axis === 'x' ? '1' : '2')) });
    const surfaceKey = (p) => `${p.track}|${p.device}|${p.xParam}|${p.yParam}`;
    const surfaces = new Map(); // surfaceKey -> { held: [id...], cells: Map(id -> {x, y}), before: {x, y} | null }

    const surface = (p) => {
      const k = surfaceKey(p);
      if (!surfaces.has(k)) surfaces.set(k, { held: [], cells: new Map(), before: null });
      return surfaces.get(k);
    };
    const size = (p) => Math.max(2, Math.min(8, int(p.size, 8)));
    const frac = (v, n) => (Math.max(1, Math.min(n, int(v, 1))) - 1) / (n - 1);
    const value = (p, axis) => {
      const v = api.liveValue(spec(p, axis));
      return v && v.ok && typeof v.value === 'number' ? v.value : null;
    };
    const set = (p, axis, v) => {
      const sp = spec(p, axis);
      api.toLive({ cmd: 'liveSet', key: api.liveKey(sp), spec: sp, value: Math.max(0, Math.min(1, v)) });
    };
    const apply = (p, cell) => {
      set(p, 'x', cell.x);
      set(p, 'y', cell.y);
    };

    return {
      watch(params) {
        return [spec(params, 'x'), spec(params, 'y')];
      },

      press({ params, id }) {
        const s = surface(params);
        const n = size(params);
        const cell = { x: frac(params.col, n), y: frac(params.row, n) };
        if (!s.held.length) s.before = { x: value(params, 'x'), y: value(params, 'y') };
        s.cells.set(id, cell);
        s.held = s.held.filter((h) => h !== id).concat(id);
        apply(params, cell);
      },

      release({ params, id }) {
        const s = surface(params);
        s.held = s.held.filter((h) => h !== id);
        s.cells.delete(id);
        if (s.held.length) return apply(params, s.cells.get(s.held[s.held.length - 1])); // back to the pad still held
        if (params.spring === 'yes' && s.before) {
          if (s.before.x !== null) set(params, 'x', s.before.x);
          if (s.before.y !== null) set(params, 'y', s.before.y);
        }
        s.before = null;
      },

      led({ params, held }) {
        if (held) return { color: COLORS.dot, anim: 0 };
        const n = size(params);
        const x = value(params, 'x');
        const y = value(params, 'y');
        if (x === null || y === null) return { color: COLORS.off, anim: 0 };
        const onCol = Math.round(x * (n - 1)) + 1 === Math.max(1, Math.min(n, int(params.col, 1)));
        const onRow = Math.round(y * (n - 1)) + 1 === Math.max(1, Math.min(n, int(params.row, 1)));
        if (onCol && onRow) return { color: COLORS.dot, anim: 0 };
        return { color: onCol || onRow ? COLORS.line : COLORS.off, anim: 0 };
      },

      status({ params }) {
        const x = value(params, 'x');
        const y = value(params, 'y');
        const vx = api.liveValue(spec(params, 'x'));
        const vy = api.liveValue(spec(params, 'y'));
        if (x === null || y === null) return 'XY: parametri nisu pronađeni';
        const show = (v, f) => `${(v && v.name) || ''} ${(v && v.display) || Math.round(f * 100)}`.trim();
        return `XY ${show(vx, x)} · ${show(vy, y)}`;
      },
    };
  },
};
