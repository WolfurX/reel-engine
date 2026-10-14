// fx.js: the NAMED element-motion
// vocabulary of the reel engine. Pure like moves.js: every function maps (time, params) to plain numbers the renderer
// applies. No DOM, no Math.random (particles, glitch and shake are seeded), so the same spec renders the same frames.
//
// Scene spec (project.json "scenes"[i].fx, or SC[i].fx in index.html), a list:
//   "fx": [{"fx": "count-up", "target": "num", "from": 0, "to": 99, "at": 0.2, "dur": 0.8}]
// Common params: dur (s), at (s after the scene starts), ease, strength
// (soft | normal | strong or a number), target (an element name the scene draws), dir. Unknown names, eases or
// strengths throw (the frame renderer aborts on the page error; build.py refuses them before any render).
// The group-3 transitions (mask / shape / liquid transition, zoom through, flip, glitch as a cut) are CUT names in moves.js.
'use strict';
const EFX = (() => {
  const VOCAB = /*VOCAB*/{
    "fx": ["pop-in", "stagger", "burst", "line draw", "mask reveal", "typewriter", "count-up", "kinetic typography",
           "easing", "overshoot", "squash & stretch", "shape morph", "liquid motion", "motion trail", "particles", "parallax",
           "light sweep", "glitch", "impact shake"],
    "cuts": ["mask transition", "shape transition", "liquid transition", "zoom through", "flip"],
    "alias": {"pop in": "pop-in", "popin": "pop-in", "pop": "pop-in", "staggered": "stagger", "explode": "burst",
              "draw on": "line draw", "line drawing": "line draw", "draw": "line draw", "reveal": "mask reveal", "mask": "mask reveal",
              "typing": "typewriter", "type on": "typewriter", "type": "typewriter", "count up": "count-up", "countup": "count-up",
              "counter": "count-up", "kinetic type": "kinetic typography", "kinetic text": "kinetic typography", "kinetic": "kinetic typography",
              "ease": "easing", "squash and stretch": "squash & stretch", "squash stretch": "squash & stretch", "squash": "squash & stretch",
              "morph": "shape morph", "morphing": "shape morph", "shape morphing": "shape morph", "liquid": "liquid motion",
              "trail": "motion trail", "afterimage": "motion trail", "particle": "particles", "confetti": "particles",
              "sweep": "light sweep", "shine": "light sweep", "glint": "light sweep", "shake": "impact shake", "impact": "impact shake"}
  }/*END*/;
  // names are matched on a normal form: lower case, & -> and, every run of other characters -> one space
  const key = s => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const NAMES = {}; VOCAB.fx.forEach(n => { NAMES[key(n)] = n; }); for (const a in VOCAB.alias) NAMES[key(a)] = VOCAB.alias[a];
  const CUTS = new Set(VOCAB.cuts.map(key));

  // eases: the moves.js five + back (overshoot), elastic, bounce
  const backOut = (u, c = 1.70158) => 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
  const bounceOut = u => { const n = 7.5625, d = 2.75;
    if (u < 1 / d) return n * u * u; if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
    if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375; return n * (u -= 2.625 / d) * u + 0.984375; };
  const EASE = {
    linear: u => u, in: u => u * u * u, out: u => 1 - Math.pow(1 - u, 3),
    inOut: u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2,
    smooth: u => u * u * (3 - 2 * u),
    back: u => backOut(u), overshoot: u => backOut(u),
    elastic: u => u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
    bounce: bounceOut,
  };
  const STRENGTH = { soft: 0.6, normal: 1, strong: 1.6 };
  const clamp01 = x => Math.max(0, Math.min(1, x)), lerp = (a, b, u) => a + (b - a) * u, TAU = Math.PI * 2;

  // ---------- parsing
  function norm(raw, where) {
    const k = key(raw);
    if (NAMES[k]) return NAMES[k];
    if (CUTS.has(k)) throw new Error(`${where}: "${raw}" is a transition, write it as the scene's "cut" (moves.js), not as an fx`);
    throw new Error(`${where}: "${raw}" is not a known fx name. Known: ${VOCAB.fx.join(', ')}`);
  }
  const NEED_TARGET = new Set(['impact shake']);  // the shake belongs to the thing that lands, never decoration
  function parse(spec, where = 'fx') {
    if (spec === undefined || spec === null) return [];
    return (Array.isArray(spec) ? spec : [spec]).map((s, k) => {
      if (typeof s === 'string') s = { fx: s };
      const w = `${where}[${k}]`;
      if (!s.fx) throw new Error(`${w}: missing "fx"`);
      const name = norm(s.fx, w), p = Object.assign({}, s);
      if (p.ease !== undefined && !EASE[p.ease]) throw new Error(`${w}: unknown ease "${p.ease}" (${Object.keys(EASE).join(', ')})`);
      if (p.strength !== undefined && typeof p.strength !== 'number' && !(p.strength in STRENGTH)) throw new Error(`${w}: unknown strength "${p.strength}" (soft, normal, strong or a number)`);
      if (NEED_TARGET.has(name) && !p.target) throw new Error(`${w}: impact shake needs the "target" that lands; it never shakes as decoration`);
      return { name, p };
    });
  }

  // ---------- seeded noise
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const hash = (i, s) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  function noise(seed, t, f) {
    const r = mulberry32(seed * 7919 + 13); let s = 0, n = 0;
    for (let k = 0; k < 4; k++) { const fk = f * (0.6 + 0.8 * r()) * (1 + k * 1.7), ph = r() * TAU, ak = 1 / (1 + k * 1.3); s += ak * Math.sin(TAU * fk * t + ph); n += ak; }
    return s / n * 1.7;
  }

  // ---------- shared helpers
  const S = p => typeof p.strength === 'number' ? p.strength : STRENGTH[p.strength || 'normal'];
  function prog(p, lt, defDur, defEase) {
    const at = p.at || 0, dur = p.dur !== undefined ? p.dur : defDur, u = clamp01((lt - at) / dur);
    return { u, e: EASE[p.ease || defEase](u), at, dur, lt: lt - at };
  }
  const DIRV = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };  // where the content comes FROM (mask reveal)
  const fmt = (v, p) => { const d = p.decimals || 0, sep = p.sep !== undefined ? p.sep : ',', dot = p.point || (sep === '.' ? ',' : '.');
    let [i, f] = Math.abs(v).toFixed(d).split('.'); i = i.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return (v < 0 ? '-' : '') + (p.prefix || '') + i + (f ? dot + f : '') + (p.suffix || ''); };

  // ---------- shapes for shape morph: unit polygons sampled by angle from the centre (all star-shaped, so no twisting)
  const NP = 120;
  function polar(fn) { const pts = []; for (let k = 0; k < NP; k++) { const a = -Math.PI / 2 + k / NP * TAU, r = fn(a); pts.push([r * Math.cos(a), r * Math.sin(a)]); } return pts; }
  function polyR(verts) { return a => { const dx = Math.cos(a), dy = Math.sin(a);   // ray from 0 to the polygon edge
    for (let i = 0; i < verts.length; i++) { const [x1, y1] = verts[i], [x2, y2] = verts[(i + 1) % verts.length], ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue; const t = (x1 * ey - y1 * ex) / den, s = (x1 * dy - y1 * dx) / den; if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) return t; } return 1; }; }
  const ngon = (n, r, rot = -Math.PI / 2) => Array.from({ length: n }, (_, k) => [r * Math.cos(rot + k / n * TAU), r * Math.sin(rot + k / n * TAU)]);
  const starV = (n, R, r) => Array.from({ length: 2 * n }, (_, k) => { const a = -Math.PI / 2 + k / (2 * n) * TAU, q = k % 2 ? r : R; return [q * Math.cos(a), q * Math.sin(a)]; });
  const HEART = (() => { const d = []; for (let k = 0; k < 720; k++) { const t = k / 720 * TAU, x = 16 * Math.pow(Math.sin(t), 3), y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)); d.push([x / 16.5, (y + 1.5) / 16.5]); }
    return a => { let best = 1e9, r = 1; for (const [x, y] of d) { const da = Math.abs(((Math.atan2(y, x) - a) % TAU + TAU * 1.5) % TAU - Math.PI); if (da < best) { best = da; r = Math.hypot(x, y); } } return r; }; })();
  const SHAPES = { circle: () => 0.95, square: polyR(ngon(4, 1.2, Math.PI / 4)), star: polyR(starV(5, 1.12, 0.48)), heart: HEART,
    triangle: polyR(ngon(3, 1.15)), hexagon: polyR(ngon(6, 1.0)), diamond: polyR(ngon(4, 1.1)) };
  const SHAPE_PTS = {}; const shapePts = n => { if (!SHAPES[n]) throw new Error(`shape morph: unknown shape "${n}" (${Object.keys(SHAPES).join(', ')})`); return SHAPE_PTS[n] || (SHAPE_PTS[n] = polar(SHAPES[n])); };

  // ---------- squash & stretch: a dropped ball, parabolas with restitution r; returns height, velocity and landing times
  function bounceAt(p, lt) {
    const H = (p.height || 420) * S(p), B = p.bounces || 3, r = p.rest || 0.55, dur = p.dur || 1.3, at = p.at || 0;
    let tot = 1; for (let k = 1; k <= B; k++) tot += 2 * Math.pow(r, k);
    const c = dur / tot, g = 2 * H / (c * c);   // fall time c for height H
    const lands = [at + c]; for (let k = 1; k <= B; k++) lands.push(lands[k - 1] + 2 * c * Math.pow(r, k));
    const t = lt; let y = 0, v = 0;
    if (t < at) { y = H; v = 0; }
    else if (t < lands[0]) { const s = t - at; y = H - 0.5 * g * s * s; v = -g * s; }
    else { let k = 0; while (k < B && t >= lands[k + 1]) k++;
      if (k < B) { const v0 = g * c * Math.pow(r, k + 1), s = t - lands[k]; y = v0 * s - 0.5 * g * s * s; v = v0 - g * s; } }
    return { y: Math.max(0, y), v, vmax: g * c, lands };
  }

  // kinetic typography chunks
  const KSTYLES = ['stamp', 'bounce', 'spin', 'stretch', 'wave'];
  function kChunks(p) {
    if (Array.isArray(p.chunks)) return p.chunks.map(String);
    const txt = p.text !== undefined ? String(p.text).trim() : ''; if (!txt) return [];
    if (txt.includes('/')) return txt.split('/').map(x => x.trim()).filter(Boolean);
    const w = txt.split(/\s+/), per = Math.max(1, Math.min(2, p.words || 1)), out = [];
    for (let i = 0; i < w.length; i += per) out.push(w.slice(i, i + per).join(' '));
    return out;
  }

  // ---------- the effects: (p, lt, ctx) -> state of plain numbers. lt = seconds since the scene started.
  const FX = {
    'pop-in': (p, lt) => { const q = prog(p, lt, 0.45, 'linear'), e = p.ease ? q.e : (q.u <= 0 ? 0 : backOut(q.u, 1.70158 * 1.6 * S(p)));
      return { op: clamp01(q.u / 0.22), s: Math.max(0, e) }; },
    'stagger': (p, lt, ctx) => { const n = p.n || ctx.n || 5, gap = p.gap !== undefined ? p.gap : 0.08, d = p.dur !== undefined ? p.dur : 0.45, at = p.at || 0, of = p.of || 'grow';
      const items = []; for (let i = 0; i < n; i++) { const u = clamp01((lt - at - i * gap) / d), e = EASE[p.ease || 'back'](u);
        items.push({ u, e, op: clamp01(u / 0.2), s: of === 'pop' ? Math.max(0, e) : 1, sy: of === 'grow' ? Math.max(0, e) : 1, dy: of === 'rise' ? (1 - e) * 80 * S(p) : 0 }); }
      return { items }; },
    'burst': (p, lt) => { const q = prog(p, lt, 0.7, 'out'), n = p.count || 12, R = (p.radius || 120) * S(p), seed = p.seed || 3;
      const s = q.u <= 0 ? 0 : Math.max(0, backOut(clamp01(q.lt / 0.35), 2.6 * S(p))), rays = [], dots = [];
      for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + k / n * TAU + (hash(k, seed) - 0.5) * 0.25, e1 = EASE.out(clamp01(q.u * 1.25)), e2 = EASE.out(clamp01(q.u * 1.25 - 0.18));
        rays.push({ a, r0: R * (0.85 + 1.0 * e2), r1: R * (0.95 + 1.15 * e1), w: 9 * (1 - q.u) + 2, op: q.u > 0 && q.u < 1 ? 1 - q.u * q.u : 0 });
        const a2 = a + Math.PI / n, d = R * (1.0 + 1.5 * EASE.out(q.u)) * (0.8 + 0.4 * hash(k, seed + 1));
        dots.push({ x: d * Math.cos(a2), y: d * Math.sin(a2) + 60 * q.u * q.u, r: 7 * (1 - q.u) * (0.6 + 0.8 * hash(k, seed + 2)), op: q.u > 0 && q.u < 1 ? 1 - q.u : 0, c: k % 3 }); }
      return { s, op: clamp01(q.u / 0.12), rays, dots }; },
    'line draw': (p, lt) => { const q = prog(p, lt, 0.9, 'inOut'); return { draw: q.e, op: q.u > 0 ? 1 : 0 }; },
    'mask reveal': (p, lt) => { const q = prog(p, lt, 0.55, 'out'), v = DIRV[p.dir || 'up']; if (!v) throw new Error(`mask reveal: dir "${p.dir}" (up, down, left, right)`);
      return { reveal: q.e, ox: v[0] * (1 - q.e), oy: v[1] * (1 - q.e) }; },   // offsets in units of the element's box size
    'typewriter': (p, lt, ctx) => { const n = p.text !== undefined ? String(p.text).length : (ctx.n || 0), cps = (p.cps || 16) * S(p), at = p.at || 0;
      const chars = Math.max(0, Math.min(n, Math.floor((lt - at) * cps))), done = chars >= n, tdone = at + n / cps;
      return { chars, done, caret: lt < at ? 0 : (!done ? 1 : (Math.floor((lt - tdone) * 2.4) % 2 ? 0 : 1)) }; },
    'count-up': (p, lt) => { const q = prog(p, lt, 1.0, 'out'), f = p.from || 0, t = p.to !== undefined ? p.to : 100, v = f + (t - f) * q.e;
      const shown = (p.decimals ? v : Math.round(v)); return { value: v, text: fmt(shown, p), u: q.u, done: q.u >= 1 }; },
    // ONE chunk on screen at a time, one or two words, each landing on its own beat (`beat` s, default 0.5).
    // Chunks: "a / b c / d" splits on slashes, else `words` (1 or 2) per chunk; `chunks` takes a list. `style` may be a list (cycles per chunk).
    // The renderer measures the glyphs (engine.js fxText) and fits the chunk to `maxW` px (default 840).
    'kinetic typography': (p, lt) => { const ch = kChunks(p), beat = p.beat || 0.5, at = p.at || 0, k = S(p), styles = [].concat(p.style || 'stamp'), t = lt - at;
      styles.forEach(st => { if (!KSTYLES.includes(st)) throw new Error(`kinetic typography: style "${st}" (${KSTYLES.join(', ')})`); });
      const none = { chunks: ch, cur: -1, text: '', chars: [], whole: { s: 1, rot: 0, op: 0, sx: 1, sy: 1 } };
      if (!ch.length || t < 0) return none;
      const cur = Math.min(ch.length - 1, Math.floor(t / beat)), tl = t - cur * beat, st = styles[cur % styles.length], str = ch[cur], n = str.length;
      const d = Math.min(p.dur || 0.3, beat * 0.75), g = Math.min(0.035, d * 0.6 / Math.max(1, n)), out = [], whole = { s: 1, rot: 0, op: 1, sx: 1, sy: 1, style: st };
      for (let i = 0; i < n; i++) { const c = { dx: 0, dy: 0, rot: 0, s: 1, sx: 1, sy: 1, op: 1 }, u = clamp01((tl - i * g) / d);
        if (st === 'bounce') { c.op = clamp01(u / 0.12); c.dy = (1 - backOut(u, 2.2)) * 130 * k; const sq = Math.sin(clamp01(u * 1.4) * Math.PI) * 0.18; c.sy = 1 + sq; c.sx = 1 - sq * 0.6; }
        else if (st === 'spin') { c.op = clamp01(u / 0.1); c.sx = Math.max(0.02, Math.cos((1 - backOut(u, 1.6)) * Math.PI / 2)); c.dy = (1 - EASE.out(u)) * 26; }   // a turn about the glyph's own vertical axis: no smear
        else if (st === 'wave') { const v = tl - i * g; c.op = clamp01(v / 0.08); c.dy = -Math.sin(Math.max(0, v) * 13) * 34 * k * Math.exp(-Math.max(0, v) * 4.5) + (1 - EASE.out(clamp01(v / 0.18))) * 80; }
        out.push(c); }
      if (st === 'stamp') { const u = clamp01(tl / 0.18), post = tl - 0.18; whole.s = lerp(2.1 * k, 1, EASE.in(u)) * (u >= 1 ? 1 + 0.1 * Math.exp(-post * 16) * Math.cos(post * 42) : 1);
        whole.op = clamp01(u / 0.3); whole.rot = (1 - u) * (cur % 2 ? 9 : -9); }
      if (st === 'stretch') { const u = clamp01(tl / 0.42), e = EASE.elastic(u); whole.sx = Math.max(0.05, lerp(0.18, 1, e)); whole.sy = 1 / Math.sqrt(Math.max(0.3, whole.sx)); whole.op = clamp01(u / 0.08); }
      if (cur < ch.length - 1) { const x = clamp01((tl - (beat - 0.07)) / 0.07); whole.op *= 1 - x; whole.s *= 1 - 0.12 * x; }   // clears just before the next beat
      return { chunks: ch, cur, text: str, chars: out, whole, beat, land: at + cur * beat }; },
    'easing': (p, lt) => { const q = prog(p, lt, 0.9, 'inOut'), D = (p.dist || 600) * S(p), d = p.dir || 'right';
      const v = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }[d]; if (!v) throw new Error(`easing: dir "${d}"`);
      return { u: q.u, e: q.e, dx: v[0] * D * q.e, dy: v[1] * D * q.e }; },
    'overshoot': (p, lt) => { const q = prog(p, lt, 0.75, 'linear'), e = p.ease ? q.e : (q.u <= 0 ? 0 : 1 - Math.exp(-6 * q.u) * Math.cos(q.u * 13 * Math.sqrt(S(p))) * (1 + 0.35 * (S(p) - 1)));
      const f = p.from || 0, t = p.to !== undefined ? p.to : 1; return { e, value: f + (t - f) * e }; },
    'squash & stretch': (p, lt) => { const b = bounceAt(p, lt), k = S(p);
      let sy = 1 + 0.32 * k * Math.abs(b.v) / b.vmax * (b.y > 2 ? 1 : 0);
      b.lands.forEach((L, j) => { const d = lt - L; if (d >= 0 && d < 0.13) sy = Math.min(sy, 1 - 0.42 * k * Math.pow(p.rest || 0.55, j) * Math.sin(d / 0.13 * Math.PI)); });
      sy = Math.max(0.45, sy); return { dy: -b.y, sx: Math.pow(sy, -0.75), sy, lands: b.lands }; },   // bottom-anchored: the renderer scales about the contact point
    'shape morph': (p, lt) => { const sh = p.shapes || ['circle', 'square', 'star', 'heart'], n = sh.length - 1, at = p.at || 0, dur = p.dur || 1.3;
      const seg = dur / n, x = clamp01((lt - at) / dur) * n, k = Math.min(n - 1, Math.floor(x)), loc = x - k;
      const hold = p.hold !== undefined ? p.hold : 0.3, u = clamp01((loc - hold * 0.5) / (1 - hold)), e = EASE[p.ease || 'inOut'](u);
      const A = shapePts(sh[k]), B = shapePts(sh[k + 1]), pts = A.map((a, i) => [lerp(a[0], B[i][0], e), lerp(a[1], B[i][1], e)]);
      const arr = loc < hold * 0.5 && k > 0 ? (hold * 0.5 - loc) / (hold * 0.5) : (k === n - 1 && x >= n ? 0 : 0);
      return { pts, from: k, to: k + 1, u: e, s: 1 + 0.08 * Math.sin(e * Math.PI) * S(p), rot: (p.spin !== undefined ? p.spin : 30) * e, arrivals: Array.from({ length: n }, (_, j) => at + seg * (j + 1 - hold * 0.5)), punch: arr }; },
    // a metaball body. Drops trail the blob on its own path a little late (they string out while it runs and
    // merge back when it stops), two slosh drops flick ahead at the stop and fall back in. engine.js fxLiquid() renders it gooey + lit.
    // Drops are px offsets from the blob centre; R = blob radius px (`r`, 120).
    'liquid motion': (p, lt) => { const q = prog(p, lt, 1.2, 'inOut'), D = (p.dist || 560) * S(p), dir = p.dir === 'left' ? -1 : 1, seed = p.seed || 5, N = 72, R = p.r || 120, ez = EASE[p.ease || 'inOut'];
      const posAt = tt => { const e = ez(clamp01((tt - q.at) / q.dur)); return [dir * (e - 0.5) * D, Math.sin(e * Math.PI) * -40]; };
      const de = (ez(clamp01(q.u + 0.01)) - ez(clamp01(q.u - 0.01))) / 0.02, v = Math.min(2.2, Math.abs(de)), [X, Y] = posAt(lt);
      const pts = []; for (let i = 0; i < N; i++) { const a = i / N * TAU, ca = Math.cos(a) * dir;
        let r = 1 + 0.06 * Math.sin(3 * a + lt * 5 + seed) + 0.045 * Math.sin(5 * a - lt * 7) + 0.04 * Math.sin(2 * a + lt * 3.3);
        r *= 1 + 0.12 * v * Math.max(0, -ca) - 0.1 * v * Math.max(0, ca);
        pts.push([r * Math.cos(a) * (1 + 0.1 * v), r * Math.sin(a) * (1 - 0.1 * v)]); }
      const drops = [], nd = p.drops || 5;
      for (let j = 0; j < nd; j++) { const lag = 0.05 + 0.13 * j, [x, y] = posAt(lt - lag), fall = 18 * j * Math.sin(clamp01((lt - q.at) / (q.dur + 0.4)) * Math.PI);
        drops.push({ x: x - X - dir * R * 0.25, y: y - Y + R * (0.2 + 0.08 * j) + fall, r: R * (0.48 - 0.07 * j) }); }   // spaced so the last drops read as separate
      const ts = q.at + q.dur * 0.78;   // the stop: two drops flick forward and fall back into the body
      for (let j = 0; j < 2; j++) { const s2 = lt - ts - j * 0.06, L = 0.62 + 0.12 * j; if (s2 <= 0 || s2 >= L) continue; const u2 = s2 / L;
        drops.push({ x: dir * R * (0.7 + (1.6 - 0.5 * j) * Math.sin(u2 * Math.PI) * (1 - 0.35 * u2)), y: -R * (1.5 + 0.5 * j) * Math.sin(u2 * Math.PI) + R * 0.1, r: R * (0.24 - 0.05 * j) * (1 - 0.3 * u2) }); }
      return { dx: X, dy: Y, pts, drops, v, R }; },
    'motion trail': (p, lt) => { const at = p.at || 0, dur = p.dur || 1.0, D = (p.dist || 640) * S(p), path = p.path || 'arc', n = p.count || 9, gap = p.gap || 0.03;
      const pos = t => { const u = clamp01((t - at) / dur), e = EASE[p.ease || 'inOut'](u);
        if (path === 'arc') return [lerp(-D / 2, D / 2, e), -Math.sin(e * Math.PI) * D * 0.42];
        if (path === 'line') return [lerp(-D / 2, D / 2, e), 0];
        if (path === 'loop') return [Math.sin(e * TAU) * D * 0.35, -Math.cos(e * TAU) * D * 0.35 + D * 0.35];
        throw new Error(`motion trail: path "${path}" (arc, line, loop)`); };
      const [x, y] = pos(lt), trail = [];
      for (let k = 1; k <= n; k++) { const [tx, ty] = pos(lt - k * gap), fade = Math.pow(1 - k / (n + 1), 1.6); trail.push({ dx: tx, dy: ty, op: 0.75 * fade, s: 0.35 + 0.65 * fade }); }
      return { dx: x, dy: y, trail }; },
    // fewer, bigger pieces (count 16, size 54 px) that read on a phone; engine.js draws them with an ink outline
    'particles': (p, lt) => { const at = p.at || 0, life = p.dur || 1.4, n = p.count || 16, seed = p.seed || 11, k = S(p), spread = (p.spread !== undefined ? p.spread : 360) * Math.PI / 180;
      const base = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 }[p.dir || 'up'], grav = p.gravity !== undefined ? p.gravity : 1300, t = lt - at, parts = [], size = p.size || 54;
      if (t < 0) return { parts, t };
      for (let i = 0; i < n; i++) { const a = base + (hash(i, seed) - 0.5) * spread, sp = (650 + 950 * hash(i, seed + 1)) * k, drag = 1.9;
        const fx = (1 - Math.exp(-drag * t)) / drag, x = Math.cos(a) * sp * fx, y = Math.sin(a) * sp * fx + 0.5 * grav * t * t * 0.55;
        const lf = life * (0.7 + 0.3 * hash(i, seed + 2)), op = t > lf ? 0 : 1 - Math.pow(t / lf, 4);
        parts.push({ x, y, r: size * (0.75 + 0.5 * hash(i, seed + 3)) * Math.min(1, t / 0.07), rot: (hash(i, seed + 4) - 0.5) * 520 * t, flip: 0.55 + 0.45 * Math.abs(Math.cos(t * (4 + 5 * hash(i, seed + 5)) + i)), op, shape: i % 4, c: i % 5 }); }
      return { parts, t }; },
    'parallax': (p, lt) => { const q = prog(p, lt, p.dur || 1.5, 'linear'); return { pan: q.e * (p.amount || 2.4) * S(p) * (p.dir === 'left' ? -1 : 1) }; },  // engine.js maps it to the 2.5D camera
    'light sweep': (p, lt) => { const q = prog(p, lt, 0.7, 'inOut'); return { pos: lerp(-0.35, 1.35, q.e), width: p.width || 0.22, angle: p.angle !== undefined ? p.angle : 22, op: q.u > 0 && q.u < 1 ? Math.min(1, 0.9 * S(p)) : 0 }; },
    'glitch': (p, lt) => { const at = p.at || 0, dur = p.dur || 0.5, t = lt - at, k = S(p), seed = p.seed || 23;
      if (t < 0 || t > dur) return { on: 0, slices: [], split: 0, op: 1, skew: 0 };
      const step = Math.floor(t * 24), env = Math.sin(clamp01(t / dur) * Math.PI) * 0.6 + 0.4 * (hash(step, seed) > 0.4 ? 1 : 0), slices = [], ns = 3 + Math.floor(hash(step, seed + 1) * 4);
      for (let i = 0; i < ns; i++) { const y0 = hash(step * 7 + i, seed + 2), h = 0.04 + 0.14 * hash(step * 7 + i, seed + 3); slices.push({ y0, y1: Math.min(1, y0 + h), dx: (hash(step * 7 + i, seed + 4) - 0.5) * 140 * k * env }); }
      return { on: 1, slices, split: (6 + 14 * hash(step, seed + 5)) * k * env, op: hash(step, seed + 6) > 0.85 ? 0.55 : 1, skew: (hash(step, seed + 7) - 0.5) * 10 * env }; },
    'impact shake': (p, lt) => { const at = p.at || 0, drop = p.drop || 0.22, k = S(p), land = at + drop, t = lt - at;
      const u = clamp01(t / drop), s = t < 0 ? 0 : lerp(2.6, 1, EASE.in(u)), d = lt - land, dec = p.dur || 0.5;
      const sq = d >= 0 && d < 0.3 ? Math.exp(-d * 14) * Math.cos(d * 38) : 0, amp = d >= 0 && d < dec ? Math.pow(1 - d / dec, 2) : 0;
      return { op: t < 0 ? 0 : clamp01(u / 0.4), s, sx: 1 + 0.16 * k * sq, sy: 1 - 0.18 * k * sq, land,
        shake: { dx: 34 * k * amp * noise(31, d, 13), dy: 30 * k * amp * noise(32, d, 15), rot: 1.6 * k * amp * noise(33, d, 9) * Math.PI / 180 } }; },
  };

  // the state of one parsed fx at scene time lt (ctx.n = how many items/characters the target has, when the fx needs it)
  function at(item, lt, ctx = {}) { return FX[item.name](item.p, lt, ctx); }
  // every fx on one target, as [{name, p, st}]
  function on(list, target, lt, ctx = {}) { return list.filter(f => (f.p.target || null) === target).map(f => ({ name: f.name, p: f.p, st: at(f, lt, ctx) })); }
  // screen shake of the whole scene (impact shake only), or null
  function screen(list, lt) {
    let r = null;
    for (const f of list) if (f.name === 'impact shake') { const sh = at(f, lt).shake; r = r || { dx: 0, dy: 0, rot: 0 }; r.dx += sh.dx; r.dy += sh.dy; r.rot += sh.rot; }
    return r;
  }
  // when each fx makes a sound (s after the scene starts), for beat-locked SFX: node reads this, sfx.py places the hits
  function events(item, ctx = {}) {
    const p = item.p, a = p.at || 0, k = S(p);
    switch (item.name) {
      case 'pop-in': case 'burst': case 'mask reveal': case 'line draw': case 'light sweep': case 'glitch': case 'particles': case 'easing': case 'overshoot': case 'liquid motion': case 'motion trail': case 'parallax':
        return [{ t: a, kind: item.name }];
      case 'stagger': { const n = p.n || ctx.n || 5, gap = p.gap !== undefined ? p.gap : 0.08; return Array.from({ length: n }, (_, i) => ({ t: a + i * gap, kind: 'stagger', i })); }
      case 'typewriter': { const n = p.text !== undefined ? String(p.text).length : (ctx.n || 0), cps = (p.cps || 16) * k; return Array.from({ length: n }, (_, i) => ({ t: a + (i + 1) / cps, kind: 'key', i })); }
      case 'count-up': { const d = p.dur !== undefined ? p.dur : 1.0; return [{ t: a, kind: 'count' }, { t: a + d, kind: 'count end' }]; }
      case 'kinetic typography': { const sts = [].concat(p.style || 'stamp'), b = p.beat || 0.5;   // one hit per chunk, on its beat
        return kChunks(p).map((c, i) => { const st = sts[i % sts.length]; return { t: a + i * b + (st === 'stamp' ? 0.18 : 0), kind: 'kinetic ' + st, i }; }); }
      case 'squash & stretch': return bounceAt(p, 0).lands.map((t, i) => ({ t, kind: 'land', i }));
      case 'shape morph': return at(item, 0).arrivals.map((t, i) => ({ t, kind: 'morph', i }));
      case 'impact shake': return [{ t: a + (p.drop || 0.22), kind: 'impact' }];
    }
    return [];
  }
  return { kChunks, VOCAB, EASE, STRENGTH, key, norm, parse, at, on, screen, events, noise, hash, shapePts, SHAPES: Object.keys(SHAPES) };
})();
if (typeof module !== 'undefined') module.exports = EFX;
