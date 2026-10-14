// moves.js: the NAMED camera-move,
// time-effect and transition vocabulary of the reel engine. Pure: every function maps (time, params) to numbers or a matrix.
// No DOM, no Math.random (handheld is seeded noise), so the same spec renders the same frames every time.
//
// Scene spec (project.json "scenes"[i], or SC[i].cam / SC[i].cut in index.html):
//   "cam": {"move": "dolly in", "dur": 3, "ease": "inOut", "subject": "hero", "speed": "slow"}   (an array composes moves)
//   "cut": "whip pan"  or  {"name": "match cut", "match": ["sun", "moon"]}      = the transition OUT of this scene
// Unknown names, eases or speeds throw (the frame renderer aborts on the page error).
//
// World model (2.5D): a scene is flat cards at depths (sky 1000, bg 20, mid 6, fg 3 by default) drawn in rest-screen px.
// The camera is a real 3D camera (x, y, z, yaw, pitch, roll, zoom) projected onto each card; each card gets the affine fit
// of that projection, so parallax, orbit, crane and dolly zoom come from geometry, not from per-move hand tuning.
'use strict';
const MOVES = (() => {
  const F = 1000, D2R = Math.PI / 180;
  const VOCAB = /*VOCAB*/{
    "camera": ["static", "pan", "tilt", "dolly in", "zoom in", "tracking shot", "orbit", "crane up", "dolly zoom", "rack focus", "handheld", "fpv", "dutch angle"],
    "time": ["slow motion", "speed ramp", "time-lapse", "freeze frame"],
    "cut": ["cut", "jump cut", "match cut", "whip pan", "cross dissolve", "wipe", "smash cut", "j-cut", "l-cut", "zoom through",
            "mask transition", "shape transition", "liquid transition", "flip", "glitch"],
    "alias": {"orbit (arc)": "orbit", "orbit (arc shot)": "orbit", "arc shot": "orbit", "arc": "orbit",
              "dolly zoom (vertigo)": "dolly zoom", "vertigo": "dolly zoom", "fpv drone shot": "fpv", "fpv drone": "fpv",
              "timelapse": "time-lapse", "time lapse": "time-lapse", "slow-mo": "slow motion", "slowmo": "slow motion",
              "j cut": "j-cut", "l cut": "l-cut", "hard cut": "cut", "dissolve": "cross dissolve", "locked": "static",
              "dolly out": "dolly in:out", "zoom out": "zoom in:out", "crane down": "crane up:down",
              "iris": "mask transition", "circle wipe": "mask transition", "shape wipe": "shape transition", "liquid": "liquid transition",
              "drip": "liquid transition", "card flip": "flip", "glitch cut": "glitch", "zoom thru": "zoom through"}
  }/*END*/;
  const EASE = {
    linear: u => u, in: u => u * u * u, out: u => 1 - Math.pow(1 - u, 3),
    inOut: u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2,
    smooth: u => u * u * (3 - 2 * u),
    back: u => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2), overshoot: u => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2),
    elastic: u => u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
    bounce: u => { const n = 7.5625, d = 2.75; if (u < 1 / d) return n * u * u; if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
      if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375; return n * (u -= 2.625 / d) * u + 0.984375; },
  };
  const SPEED = { slow: 0.6, normal: 1, fast: 1.6 };
  const clamp01 = x => Math.max(0, Math.min(1, x)), lerp = (a, b, u) => a + (b - a) * u;

  // ---------- names
  function norm(raw, kinds, where) {
    const key = String(raw).toLowerCase().trim().replace(/[_\s]+/g, ' ');
    let name = key, dir;
    if (VOCAB.alias[key]) [name, dir] = VOCAB.alias[key].split(':');
    for (const kind of kinds) if (VOCAB[kind].includes(name)) return { name, kind, dir };
    const other = ['camera', 'time', 'cut'].find(k => !kinds.includes(k) && VOCAB[k].includes(name));
    throw new Error(`${where}: "${raw}" is ${other ? `a ${other} name, not allowed here` : 'not a known name'}. Known: ${kinds.map(k => VOCAB[k].join(', ')).join(' | ')}`);
  }
  function checkParams(p, where) {
    if (p.ease !== undefined && !EASE[p.ease]) throw new Error(`${where}: unknown ease "${p.ease}" (${Object.keys(EASE).join(', ')})`);
    if (p.speed !== undefined && typeof p.speed !== 'number' && !(p.speed in SPEED)) throw new Error(`${where}: unknown speed "${p.speed}" (slow, normal, fast or a number)`);
  }
  // "cam": object | array | undefined -> [{name, kind, p}]
  function parseCam(spec, where = 'cam') {
    if (spec === undefined || spec === null) return [];
    const list = (Array.isArray(spec) ? spec : [spec]).map((s, k) => {
      if (typeof s === 'string') s = { move: s };
      if (!s.move) throw new Error(`${where}[${k}]: missing "move"`);
      const n = norm(s.move, ['camera', 'time'], where), p = Object.assign({}, s);
      if (n.dir && p.dir === undefined) p.dir = n.dir;
      checkParams(p, where);
      return { name: n.name, kind: n.kind, p };
    });
    if (list.filter(m => m.kind === 'time').length > 1) throw new Error(`${where}: one time effect per scene`);
    return list;
  }
  // "cut": string | object | undefined -> {name, ...params} | null
  function parseCut(spec, where = 'cut') {
    if (spec === undefined || spec === null) return null;
    const s = typeof spec === 'string' ? { name: spec } : Object.assign({}, spec);
    const n = norm(s.name, ['cut'], where); s.name = n.name;
    if (n.name === 'match cut' && s.match && !(Array.isArray(s.match) && s.match.length === 2)) throw new Error(`${where}: match must be ["outgoing anchor", "incoming anchor"]`);
    return s;
  }

  // ---------- seeded noise (handheld, shake): sum of sines with seeded frequency and phase, smooth and repeatable
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function noise(seed, t, f) {
    const r = mulberry32(seed * 7919 + 13); let s = 0, n = 0;
    for (let k = 0; k < 4; k++) { const fk = f * (0.6 + 0.8 * r()) * (1 + k * 1.7), ph = r() * 6.2832, ak = 1 / (1 + k * 1.3); s += ak * Math.sin(6.2832 * fk * t + ph); n += ak; }
    return s / n * 1.7;
  }

  // ---------- progress of one move inside its scene: dur/at in seconds, eased
  function prog(p, lt, len, defEase) {
    const at = p.at || 0, dur = p.dur !== undefined ? p.dur : Math.max(0.001, len - at);
    const u = clamp01((lt - at) / dur); return { u, e: EASE[p.ease || defEase](u), at, dur };
  }
  const amp = p => typeof p.speed === 'number' ? p.speed : SPEED[p.speed || 'normal'];
  const sgn = (p, neg) => (p.dir === neg ? -1 : 1);

  // ---------- camera moves: each adds into the camera c. Angles in params are degrees; c holds radians.
  // ctx.subj = subject world position [X, Y, Z] (or null), ctx.depth = layer depths
  const CAM = {
    'static': () => {},
    'pan': (c, p, q) => { const A = (p.amount || 32) * amp(p), f = p.from !== undefined ? p.from : -A / 2, t = p.to !== undefined ? p.to : A / 2;
      c.yaw += sgn(p, 'left') * lerp(f, t, q.e) * D2R; },
    'tilt': (c, p, q) => { const A = (p.amount || 34) * amp(p), d = p.dir === 'down' ? -1 : 1, f = p.from !== undefined ? p.from : -d * A / 2, t = p.to !== undefined ? p.to : d * A / 2;
      c.pitch += lerp(f, t, q.e) * D2R; },
    'dolly in': (c, p, q, ctx) => { const k = (p.amount || 0.55) * amp(p) * sgn(p, 'out') * q.e, S = ctx.subj || [0, 0, ctx.depth.fg];
      c.x += S[0] * k; c.y += S[1] * k; c.z += S[2] * k; },
    'zoom in': (c, p, q, ctx) => { const Z = Math.pow(p.amount || 1.8, amp(p)), s = p.dir === 'out' ? Math.pow(Z, 1 - q.e) : Math.pow(Z, q.e);
      const o = ctx.subjScreen || [ctx.W / 2, ctx.H / 2]; c.post.push({ s, ox: o[0], oy: o[1] }); },
    'tracking shot': (c, p, q) => { const D = (p.amount || 2.4) * amp(p) * sgn(p, 'left') * q.e; c.x += D; c.carry += D; },
    'orbit': (c, p, q, ctx) => { const A = (p.amount || 44) * amp(p) * D2R, th = sgn(p, 'left') * A * (q.e - 0.5), S = ctx.subj || [0, 0, ctx.depth.fg];
      const R = Math.hypot(S[0], S[2]), b0 = Math.atan2(S[0], S[2]);
      const cx = S[0] - R * Math.sin(b0 - th), cz = S[2] - R * Math.cos(b0 - th);
      c.x += cx; c.z += cz; c.yaw += Math.atan2(S[0] - cx, S[2] - cz) - b0; c.subjYaw += th; },
    'crane up': (c, p, q) => { const H = (p.amount || 1.6) * amp(p), d = p.dir === 'down' ? -1 : 1;
      c.y += d * H * (0.3 - q.e); c.pitch += d * lerp(3, -7, q.e) * D2R; },
    'dolly zoom': (c, p, q, ctx) => { const D = (p.amount || 2.4) * amp(p), S = ctx.subj || [0, 0, ctx.depth.fg], z = (p.dir === 'in' ? 1 : -1) * Math.min(D, S[2] * 0.7) * q.e;
      c.z += z; c.zoom *= (S[2] - c.z) / (S[2] - (c.z - z)); },
    'rack focus': (c, p, q, ctx) => { const dz = v => typeof v === 'number' ? v : ctx.depth[v];
      const f0 = dz(p.from !== undefined ? p.from : (p.dir === 'in' ? 'bg' : (ctx.subj ? ctx.subj[2] : 'fg'))), f1 = dz(p.to !== undefined ? p.to : (p.dir === 'in' ? 'fg' : 'bg'));
      if (!(f0 > 0 && f1 > 0)) throw new Error('rack focus: from/to must be a layer name or a depth');
      c.focus = 1 / lerp(1 / f0, 1 / f1, q.e); c.aperture = Math.max(c.aperture, (p.aperture || 70) * amp(p)); c.zoom *= 1 + 0.015 * q.e; },
    'handheld': (c, p, q, ctx, lt) => { const at = p.at || 0, a = (p.amount || 1) * amp(p) * (p.at === undefined ? 1 : EASE.smooth(clamp01((lt - at) / 0.25))) * (p.dur === undefined ? 1 : EASE.smooth(clamp01((at + p.dur - lt) / 0.25))), s = p.seed || 7, t = lt;  // at/dur window, 0.25 s fades
      c.x += a * 0.035 * noise(s, t, 0.9); c.y += a * 0.03 * noise(s + 1, t, 1.2);
      c.yaw += a * 0.8 * D2R * noise(s + 2, t, 0.7); c.pitch += a * 0.6 * D2R * noise(s + 3, t, 0.9); c.roll += a * 1.0 * D2R * noise(s + 4, t, 0.55);
      c.yaw += a * 0.18 * D2R * noise(s + 5, t, 4.5); c.pitch += a * 0.15 * D2R * noise(s + 6, t, 5.2); },
    // with a subject, the drone never flies into it. It swerves to the open side as it closes on the subject's
    // plane (clearance ramps in over `approach`), passes at >= `min` world units (default 1.6) and banks into the turn.
    'fpv': (c, p, q, ctx) => { const D = (p.amount || 7) * amp(p), e = q.e, w = Math.PI * 1.6 * q.u, S = ctx && ctx.subj;
      if (!S) { c.z += D * e; c.y += -0.55 * q.u; c.x += 0.6 * Math.sin(w); c.yaw += 7 * D2R * Math.cos(w); c.roll += -14 * D2R * Math.sin(w) * sgn(p, 'left'); c.pitch += -5 * D2R * q.u; return; }
      const md = p.min || 1.6, side = p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : (S[0] > 0.05 ? -1 : 1), app = p.approach || Math.max(2.6, md * 1.8), clr = md + 0.45;
      const lat = z => { const d = S[2] - z; return side * clr * (d > 0 ? sm(1 - d / app) : 1 - 0.5 * sm(-d / app)); };   // swerve in, hold while passing, ease half back
      const z = D * e, sway = 0.25 * Math.sin(w);
      let x = lat(z) + sway; const y = -0.45 * q.u;
      const dd = Math.hypot(x - S[0], y - S[1], z - S[2]); if (dd < md) x = S[0] + Math.sign(x - S[0] || side) * Math.sqrt(Math.max(0, md * md - (y - S[1]) ** 2 - (z - S[2]) ** 2)) + 1e-3;   // hard floor
      const dz = 0.02, slope = (lat(z + dz) - lat(z - dz)) / (2 * dz), curv = (lat(z + dz) - 2 * lat(z) + lat(z - dz)) / (dz * dz);
      c.x += x; c.y += y; c.z += z;
      c.yaw += Math.atan(slope) * 0.55 + 5 * D2R * Math.cos(w);            // look along the flight path (a bit), drone wobble
      c.roll += Math.max(-26, Math.min(26, -side * Math.abs(curv) * 7 + -8 * Math.sin(w) * side)) * D2R;   // bank into the swerve
      c.pitch += -5 * D2R * q.u; },
    'dutch angle': (c, p, q) => { const A = (p.amount || 15) * amp(p) * D2R * sgn(p, 'right');
      c.roll += A * EASE.out(clamp01(q.u / 0.4)); c.z += 0.3 * q.e; },
  };
  const DEF_EASE = { 'tracking shot': 'linear', 'fpv': 'in', 'dutch angle': 'out', 'handheld': 'linear' };

  function camAt(list, lt, len, ctx) {
    const c = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, zoom: 1, post: [], focus: 1, aperture: 0, carry: 0, subjYaw: 0 };
    for (const m of list) if (m.kind === 'camera') CAM[m.name](c, m.p, prog(m.p, lt, len, DEF_EASE[m.name] || 'inOut'), ctx, lt);
    return c;
  }

  // ---------- time effects: scene animation time tau(lt) (the camera keeps real time). rate = current speed, for UI chips
  function timeAt(list, lt, len) {
    const m = list.find(m => m.kind === 'time'); if (!m) return { tau: lt, rate: 1, flash: 0 };
    const p = m.p, at = p.at || 0;  // seconds, like every other param
    if (m.name === 'slow motion') { const r = p.rate || 0.25 * amp(p); return lt < at ? { tau: lt, rate: 1, flash: 0 } : { tau: at + (lt - at) * r, rate: r, flash: 0 }; }
    if (m.name === 'time-lapse') { const r = p.rate || 40 * amp(p); return { tau: lt * r, rate: r, flash: 0 }; }
    if (m.name === 'freeze frame') { const a = p.at !== undefined ? at : 0.45 * len; return lt < a ? { tau: lt, rate: 1, flash: 0 } : { tau: a, rate: 0, flash: Math.max(0, 1 - (lt - a) / 0.22), frozen: lt - a }; }
    // speed ramp: hi -> lo at `at` s (default 0.3 of the scene), back up at `back` s (default 0.78 of it; false = stay slow)
    const hi = p.hi || 3, lo = p.lo || 0.15, a0 = p.at !== undefined ? at : 0.3 * len, w = p.ramp || 0.2, b0 = p.back === false ? Infinity : (p.back !== undefined ? p.back : 0.78 * len);
    const rate = s => { let r = lerp(hi, lo, EASE.smooth(clamp01((s - a0) / w))); if (s > b0) r = lerp(lo, hi, EASE.smooth(clamp01((s - b0) / w))); return r; };
    const N = 240, T = Math.max(0, lt); let tau = 0; for (let k = 0; k < N; k++) tau += rate((k + 0.5) / N * T) * T / N;
    return { tau, rate: rate(T), flash: 0 };
  }

  // ---------- projection: world [X, Y, Z] (Y down, like the screen) -> screen px, through the camera
  function project(c, X, Y, Z, W, H) {
    let x = X - c.x, y = Y - c.y, z = Z - c.z;
    let cs = Math.cos(c.yaw), sn = Math.sin(c.yaw); [x, z] = [x * cs - z * sn, x * sn + z * cs];
    cs = Math.cos(c.pitch); sn = Math.sin(c.pitch); [y, z] = [y * cs + z * sn, -y * sn + z * cs];
    const k = F * c.zoom / Math.max(z, 1e-3); return [W / 2 + x * k, H / 2 + y * k, z];
  }
  const toWorld = (px, py, Z, W, H) => [(px - W / 2) * Z / F, (py - H / 2) * Z / F, Z];
  // affine fit of the card's projection around where the centre ray meets it -> SVG matrix + camera distance
  function layerMatrix(c, Z, W, H) {
    const dir = [Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)];
    const tt = (Z - c.z) / Math.max(dir[2], 0.05), ax = W / 2 + (c.x + tt * dir[0]) * F / Z, ay = H / 2 + (c.y + tt * dir[1]) * F / Z, h = 240;
    const w = (px, py) => project(c, ...toWorld(px, py, Z, W, H), W, H);
    const p0 = w(ax, ay), p1 = w(ax + h, ay), p2 = w(ax, ay + h);
    const a = (p1[0] - p0[0]) / h, b = (p1[1] - p0[1]) / h, cc = (p2[0] - p0[0]) / h, d = (p2[1] - p0[1]) / h;
    return { m: [a, b, cc, d, p0[0] - a * ax - cc * ay, p0[1] - b * ax - d * ay], dist: p0[2] };
  }
  // 2D affine helpers: [a b c d e f] = SVG matrix; mul(A, B) applies B first
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const apply = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  // screen-space ops in push order: {s, ox, oy} scale about a point, {dx, dy} shift, {rot, ox, oy} rotate (radians)
  function postMatrix(c, W, H) {
    let M = [1, 0, 0, 1, 0, 0];
    const ops = c.roll ? [{ rot: c.roll, ox: W / 2, oy: H / 2 }, ...c.post] : c.post;
    for (const o of ops) {
      let A;
      if (o.rot !== undefined) { const cs = Math.cos(o.rot), sn = Math.sin(o.rot); A = [cs, sn, -sn, cs, o.ox - cs * o.ox + sn * o.oy, o.oy - sn * o.ox - cs * o.oy]; }
      else if (o.s !== undefined) A = [o.s, 0, 0, o.s, o.ox * (1 - o.s) + (o.dx || 0), o.oy * (1 - o.s) + (o.dy || 0)];
      else if (o.m !== undefined) { const [a, b, c, d] = o.m; A = [a, b, c, d, o.ox - a * o.ox - c * o.oy, o.oy - b * o.ox - d * o.oy]; }  // flip
      else A = [1, 0, 0, 1, o.dx || 0, o.dy || 0];
      M = mul(A, M);
    }
    return M;
  }
  const blurPx = (c, dist) => c.aperture ? Math.min(26, c.aperture * Math.abs(1 / dist - 1 / c.focus)) : 0;

  // ---------- transitions. window = [seconds before the cut, seconds after] in which both scenes are drawn
  const CUTW = { 'cut': [0, 0], 'jump cut': [0, 0], 'match cut': [0, 0], 'whip pan': [0, 0], 'smash cut': [0, 0], 'j-cut': [0, 0], 'l-cut': [0, 0], 'zoom through': [0.16, 0.16] };
  function cutWindow(cut) {
    if (!cut) return [0, 0];
    if (cut.name === 'cross dissolve') { const d = cut.dur || 0.5; return [d / 2, d / 2]; }
    if (cut.name === 'wipe') { const d = cut.dur || 0.45; return [d / 2, d / 2]; }
    if (NEWCUT[cut.name]) { const d = cut.dur || NEWCUT[cut.name]; return [d / 2, d / 2]; }
    if (cut.name === 'zoom through' && cut.into) { const d = cut.dur || 0.6; return [d * 0.7, d * 0.3]; }
    return CUTW[cut.name];
  }
  const sm = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
  // ---------- shape-based transitions. Default lengths (s), windows centred on the cut.
  const NEWCUT = { 'mask transition': 0.6, 'shape transition': 0.7, 'liquid transition': 1.0, 'flip': 0.7, 'glitch': 0.3 };   // liquid 0.8 -> 1.0 (read the pour), flip 0.6 -> 0.7
  const hs = (i, s) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  const f1 = v => v.toFixed(1);
  const wu = (cut, dt) => { const d = cut.dur || NEWCUT[cut.name]; return clamp01((dt + d / 2) / d); };   // 0..1 across the window, 0.5 at the cut
  // glitch slices (shared by the glitch cut; fx.js has the element version): seeded per 1/24 s step, amplitude a
  function glitchAt(t, a, seed = 41) {
    const step = Math.floor(t * 24), slices = [], n = 3 + Math.floor(hs(step, seed) * 4);
    for (let i = 0; i < n; i++) { const y0 = hs(step * 7 + i, seed + 2), h = 0.03 + 0.12 * hs(step * 7 + i, seed + 3); slices.push({ y0, y1: Math.min(1, y0 + h), dx: (hs(step * 7 + i, seed + 4) - 0.5) * 220 * a }); }
    return { slices, split: (8 + 16 * hs(step, seed + 5)) * a, a };
  }
  // drippy liquid edge: region above y = Y with rounded drips hanging below it (seeded columns)
  const dripCols = (Y, grow, W, seed) => Array.from({ length: 9 }, (_, k) => ({ xc: (k + 0.5) / 9 * (W + 120) - 60 + (hs(k, seed) - 0.5) * 60, w: 60 + 70 * hs(k, seed + 1), L: (90 + 260 * hs(k, seed + 2)) * grow }));
  function dripPath(Y, grow, W, seed) {
    let d = `M -60 -3000 L -60 ${f1(Y)} `;
    for (const { xc, w, L } of dripCols(Y, grow, W, seed)) {   // the drip ends bulge (a drop hanging on the sheet), not a plain U
      const b = w * 0.62;
      d += `L ${f1(xc - w / 2)} ${f1(Y)} C ${f1(xc - w * 0.22)} ${f1(Y + L * 0.35)} ${f1(xc - w * 0.2)} ${f1(Y + L * 0.62)} ${f1(xc - b / 2)} ${f1(Y + L * 0.8)} C ${f1(xc - b * 0.62)} ${f1(Y + L + b * 0.35)} ${f1(xc + b * 0.62)} ${f1(Y + L + b * 0.35)} ${f1(xc + b / 2)} ${f1(Y + L * 0.8)} C ${f1(xc + w * 0.2)} ${f1(Y + L * 0.62)} ${f1(xc + w * 0.22)} ${f1(Y + L * 0.35)} ${f1(xc + w / 2)} ${f1(Y)} `; }
    return d + `L ${W + 60} ${f1(Y)} L ${W + 60} -3000 Z`;
  }
  const hx2 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), mixc = (a, b, k) => '#' + hx2(a).map((v, i) => Math.round(v + (hx2(b)[i] - v) * k).toString(16).padStart(2, '0')).join('');
  // the liquid transition as a lit, thick sheet. Over the old scene: a cast shadow, a dark rim, a lit body, a
  // specular line that follows every drip, a glint on each drop end and drops falling ahead. Over the new scene: the sheet's
  // trailing surface (rim + soft shadow), so the destination is revealed UNDER the liquid. Default 1.0 s.
  function liquidCut(cut, u, W, H, id, r) {
    const e = EASE.smooth(u), col = cut.color || '#FF6B6B', dark = mixc(col, '#0B0D1E', 0.5), lite = mixc(col, '#FFFFFF', 0.5);
    const Y1 = -400 + (H + 900) * e, g1 = 0.45 + 0.55 * e, band = 360 + 200 * (1 - e), Y2 = Y1 - band, g2 = 0.35 + 0.65 * e;
    const front = dripPath(Y1, g1, W, 5), back = dripPath(Y2, g2, W, 7);
    if (u >= 1) { r.under = ''; return; }
    let s = `<defs><linearGradient id="${id}lq" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(Y2)}" x2="0" y2="${f1(Y1 + 360 * g1)}"><stop offset="0" stop-color="${col}"/><stop offset="0.6" stop-color="${mixc(col, '#FFFFFF', 0.18)}"/><stop offset="1" stop-color="${lite}"/></linearGradient>
      <filter id="${id}bl" filterUnits="userSpaceOnUse" x="-200" y="-400" width="${W + 400}" height="${H + 800}"><feGaussianBlur stdDeviation="16"/></filter><clipPath id="${id}bd"><path d="${front}"/></clipPath></defs>`;
    s += `<path d="${dripPath(Y1 + 30, g1, W, 5)}" fill="#000" opacity="0.34" filter="url(#${id}bl)"/>`;
    s += `<path d="${front}" fill="${dark}"/><path d="${dripPath(Y1 - 18, g1 * 0.94, W, 5)}" fill="url(#${id}lq)"/>`;
    s += `<g clip-path="url(#${id}bd)"><path d="${dripPath(Y1 - 50, g1 * 0.82, W, 5)}" fill="none" stroke="#FFFFFF" stroke-width="11" opacity="0.5" stroke-linejoin="round"/></g>`;
    for (const { xc, w, L } of dripCols(Y1, g1, W, 5)) { const b = w * 0.62, ty = Y1 + L * 0.8 + b * 0.12;
      s += `<ellipse cx="${f1(xc - b * 0.2)}" cy="${f1(ty)}" rx="${f1(b * 0.13)}" ry="${f1(b * 0.2)}" fill="#FFFFFF" opacity="0.75" transform="rotate(-18 ${f1(xc - b * 0.2)} ${f1(ty)})"/>`; }
    for (let k = 0; k < 8; k++) { const t0 = 0.1 + 0.55 * hs(k, 13), a = e - t0; if (a <= 0 || a > 0.4) continue;
      const cl = dripCols(Y1, g1, W, 5)[Math.floor(hs(k, 14) * 9)], x = cl.xc + (hs(k, 15) - 0.5) * 30, y = Y1 + cl.L + 40 + 2600 * a * a + 500 * a, rr = 14 + 16 * hs(k, 16);
      s += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(rr)}" ry="${f1(rr * 1.18)}" fill="${col}" stroke="${dark}" stroke-width="4"/><circle cx="${f1(x - rr * 0.32)}" cy="${f1(y - rr * 0.38)}" r="${f1(rr * 0.26)}" fill="#FFFFFF" opacity="0.8"/>`; }
    r.under = s;
    r.clip = `<defs><clipPath id="${id}"><path d="${back}"/></clipPath></defs>`; r.clipId = id;
    r.edge = `<path d="${dripPath(Y2 + 20, g2, W, 7)}" fill="none" stroke="#000" stroke-width="26" opacity="0.25" filter="url(#${id}bl)"/><path d="${back}" fill="none" stroke="${dark}" stroke-width="18" stroke-linejoin="round"/><path d="${dripPath(Y2 + 7, g2, W, 7)}" fill="none" stroke="${lite}" stroke-width="6" opacity="0.75" stroke-linejoin="round"/>`;
  }
  // ---------- projective: the exact card -> screen homography, so a card can keystone (orbit, flip).
  // 3x3 row-major. layerHomog = what project() does, kept whole instead of the affine fit; engine.js renders it as a warp node.
  const m3 = (A, B) => { const R = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return R; };
  const aff3 = M => [M[0], M[2], M[4], M[1], M[3], M[5], 0, 0, 1];
  function inv3(m) { const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]; }
  const ap3 = (M, x, y) => { const w = M[6] * x + M[7] * y + M[8]; return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w, w]; };
  function camSpace(c, X, Y, Z) { let x = X - c.x, y = Y - c.y, z = Z - c.z;
    let cs = Math.cos(c.yaw), sn = Math.sin(c.yaw); [x, z] = [x * cs - z * sn, x * sn + z * cs];
    cs = Math.cos(c.pitch); sn = Math.sin(c.pitch); [y, z] = [y * cs + z * sn, -y * sn + z * cs]; return [x, y, z]; }
  function layerHomog(c, Z, W, H) {
    const o = camSpace(c, ...toWorld(0, 0, Z, W, H)), ex = camSpace(c, ...toWorld(1, 0, Z, W, H)), ey = camSpace(c, ...toWorld(0, 1, Z, W, H)), k = F * c.zoom;
    return m3([k, 0, W / 2, 0, k, H / 2, 0, 0, 1], [ex[0] - o[0], ey[0] - o[0], o[0], ex[1] - o[1], ey[1] - o[1], o[1], ex[2] - o[2], ey[2] - o[2], o[2]]);
  }
  // the whole frame as a card turning th (rad) about the vertical axis, seen from d px, shrunk to s0 about the centre
  function flipHomog(th, W, H, d, s0) {
    return m3([1, 0, W / 2, 0, 1, H / 2, 0, 0, 1], m3([d * Math.cos(th), 0, 0, 0, d, 0, Math.sin(th), 0, d], m3([s0, 0, 0, 0, s0, 0, 0, 0, 1], [1, 0, -W / 2, 0, 1, -H / 2, 0, 0, 1])));
  }
  // flip: the frame turns in real perspective (the near edge grows, the far edge shrinks); the far side darkens with depth
  function flipPersp(cut, th, W, H, id) {
    const sn = Math.sin(th), s0 = 1 - 0.16 * Math.abs(sn), d = cut.persp || 1.45 * W, far = th > 0 ? 1 : 0;
    return { H: flipHomog(th, W, H, d, s0), shade: `<defs><linearGradient id="${id}fs" x1="${far ? 0 : 1}" y1="0" x2="${far}" y2="0"><stop offset="0" stop-color="#000" stop-opacity="${(0.12 * Math.abs(sn)).toFixed(3)}"/><stop offset="1" stop-color="#000" stop-opacity="${(0.7 * Math.abs(sn)).toFixed(3)}"/></linearGradient></defs><rect x="-50" y="-50" width="${W + 100}" height="${H + 100}" fill="url(#${id}fs)"/>` };
  }
  function flipM(th, side) { const cs = Math.cos(th), sn = Math.sin(th), s = 1 - 0.16 * Math.sin(Math.min(Math.PI / 2, Math.abs(th)) * 2) - 0.08 * Math.abs(sn);
    return { m: [cs * s, 0.16 * sn * side, 0, s, 0, 0] }; }
  function newCutOut(cut, dt, c, W, H, r) {
    const u = wu(cut, -dt), cx = cut.x !== undefined ? cut.x : W / 2, cy = cut.y !== undefined ? cut.y : H / 2;
    if (cut.name === 'mask transition') c.post.push({ s: 1 + 0.08 * EASE.inOut(u), ox: cx, oy: cy });
    if (cut.name === 'shape transition') { if (dt < 0) r.op = 0; }   // liquid: the old scene stays under the pour
    if (cut.name === 'flip') { if (dt < 0) r.op = 0; else { const th = EASE.in(clamp01(u * 2)) * Math.PI / 2 * 0.999, P = flipPersp(cut, th, W, H, 'flo');   // projective
      if (u > 0.002) { r.pre = `<rect x="-50" y="-50" width="${W + 100}" height="${H + 100}" fill="${cut.backdrop || '#0B0D1E'}"/>`; r.persp = P; r.fx = P.shade; } r.round = 46 * Math.min(1, u * 6); } }   // backdrop only while turning (it hid the scene before it)
    if (cut.name === 'glitch') { if (dt < 0) r.op = 0; else r.glitch = glitchAt(dt, EASE.in(clamp01(u * 2)) * (cut.amount || 1), 41); }
    if (cut.name === 'zoom through' && cut.into) { const d = cut.dur || 0.6, pre = d * 0.7, v = clamp01(1 - dt / pre), R = cut.r || 60;
      const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
      if (dt < 0) r.op = 0; else c.post.push({ s: Math.pow(far * 1.15 / R, EASE.in(v)), ox: cx, oy: cy }); }
    return r;
  }
  function newCutIn(cut, dt, c, W, H, i, r) {
    const u = wu(cut, dt), cx = cut.x !== undefined ? cut.x : W / 2, cy = cut.y !== undefined ? cut.y : H / 2, id = `mvx${i}`;
    if (cut.name === 'mask transition') { const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)), e = EASE.inOut(u), R = far * 1.04 * e;
      c.post.push({ s: 1.12 - 0.12 * e, ox: cx, oy: cy });
      if (u < 1) { const sh = cut.shape || 'circle';
        const path = sh === 'circle' ? `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(Math.max(0, R))}"/>`
          : `<path transform="translate(${f1(cx)} ${f1(cy)}) rotate(${f1(40 * e)}) scale(${(R / 0.9 * 1.6 / 1000).toFixed(5)})" d="${sh === 'star' ? 'M 0 -1000 L 235 -324 L 951 -309 L 380 124 L 588 809 L 0 400 L -588 809 L -380 124 L -951 -309 L -235 -324 Z' : 'M -1000 -1000 L 1000 -1000 L 1000 1000 L -1000 1000 Z'}"/>`;
        r.clip = `<defs><clipPath id="${id}">${path}</clipPath></defs>`; r.clipId = id;
        r.edge = sh === 'circle' && R > 1 ? `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R)}" fill="none" stroke="${cut.rim || '#FFF6D0'}" stroke-width="${f1(10 * (1 - u) + 2)}" opacity="${(0.85 * (1 - u)).toFixed(3)}"/>` : ''; } }
    if (cut.name === 'shape transition') { const cols = cut.colors || ['#FF6B6B', '#FFD23F', '#2EC4B6', '#8E7DFF', '#F4F2FF'], n = cols.length, bh = (H + 900) / n;
      if (dt < 0) r.op = 0;
      let s = `<g transform="rotate(${cut.angle !== undefined ? -cut.angle : -24} ${W / 2} ${H / 2})">`;
      for (let k = 0; k < n; k++) { const st = k * 0.045, lead = EASE.inOut(clamp01((u - st) / (0.46 - st))), trail = EASE.inOut(clamp01((u - 0.54 - st) / (0.46 - st)));
        const x0 = -900 + (W + 1800) * trail, x1 = -900 + (W + 1800) * lead; if (x1 - x0 < 1) continue;
        s += `<rect x="${f1(x0)}" y="${f1(-450 + k * bh)}" width="${f1(x1 - x0)}" height="${f1(bh + 2)}" fill="${cols[k]}"/>`; }
      r.edge = s + '</g>'; }
    if (cut.name === 'liquid transition') liquidCut(cut, u, W, H, id, r);
    if (cut.name === 'flip') { if (dt < 0) r.op = 0; else { const th = (1 - EASE.out(clamp01(u * 2 - 1))) * Math.PI / 2 * 0.999, P = flipPersp(cut, -th, W, H, 'fli' + i);   // projective
      if (u < 0.998) { r.pre = `<rect x="-50" y="-50" width="${W + 100}" height="${H + 100}" fill="${cut.backdrop || '#0B0D1E'}"/>`; r.persp = P; r.fx = P.shade; } r.round = 46 * Math.min(1, (1 - u) * 6); } }
    if (cut.name === 'glitch') { if (dt < 0) r.op = 0; else r.glitch = glitchAt(dt + 0.37, (1 - EASE.out(clamp01(u * 2 - 1))) * (cut.amount || 1), 43); }
    if (cut.name === 'zoom through' && cut.into) { const d = cut.dur || 0.6, pre = d * 0.7, R = cut.r || 60;
      const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
      if (dt < 0) { const v = clamp01(1 + dt / pre), S = Math.pow(far * 1.15 / R, EASE.in(v)); r.clip = `<defs><clipPath id="${id}"><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R * S * 0.98)}"/></clipPath></defs>`; r.clipId = id;
        c.post.push({ s: 0.55 + 0.6 * EASE.in(v), ox: cx, oy: cy }); }
      else c.post.push({ s: 1.15 - 0.15 * EASE.out(clamp01(dt / (d * 0.3))), ox: cx, oy: cy }); }
    return r;
  }
  // outgoing scene, dt = seconds BEFORE its cut (>= 0 inside the scene, < 0 inside the window after it)
  function cutOut(cut, dt, c, W, H) {
    const r = { op: 1 };
    if (NEWCUT[cut.name] || (cut.name === 'zoom through' && cut.into)) return newCutOut(cut, dt, c, W, H, r);
    if (cut.name === 'whip pan' && dt < (cut.dur || 0.24)) { const w = cut.dur || 0.24, u = 1 - Math.max(0, dt) / w; c.post.push({ dx: -(cut.dir === 'left' ? -1 : 1) * (cut.amount || 1700) * u * u * u }); }
    if (cut.name === 'zoom through') { const u = sm((0.16 - dt) / 0.32); r.op = 1 - u; c.post.push({ s: 1 + 0.35 * u, ox: 540, oy: 960 }); }
    return r;
  }
  // incoming scene, dt = seconds AFTER the cut (< 0 inside the window before it)
  function cutIn(cut, dt, c, W, H, i) {
    const r = { op: 1, clip: '', fx: '', edge: '' };
    if (NEWCUT[cut.name] || (cut.name === 'zoom through' && cut.into)) return newCutIn(cut, dt, c, W, H, i, r);
    if (cut.name === 'whip pan' && dt < (cut.dur || 0.24)) { const w = cut.dur || 0.24, u = 1 - Math.max(0, dt) / w; c.post.push({ dx: (cut.dir === 'left' ? -1 : 1) * (cut.amount || 1700) * u * u * u }); }
    if (cut.name === 'zoom through') { const u = sm((dt + 0.16) / 0.32); r.op = u; c.post.push({ s: 0.86 + 0.14 * u, ox: 540, oy: 960 }); }
    if (cut.name === 'cross dissolve') { const d = cut.dur || 0.5; r.op = sm((dt + d / 2) / d); }
    if (cut.name === 'wipe') {
      const d = cut.dur || 0.45, u = sm((dt + d / 2) / d), left = cut.dir === 'left', x = left ? W * (1 - u) : W * u;
      if (u < 1) { const id = `mvwipe${i}`;
        r.clip = `<defs><clipPath id="${id}"><rect x="${left ? x.toFixed(1) : -400}" y="-400" width="${(left ? W + 400 - x : x + 400).toFixed(1)}" height="${H + 800}"/></clipPath></defs>`;
        r.clipId = id;
        r.edge = u > 0 ? `<rect x="${(x - 22).toFixed(1)}" y="-10" width="44" height="${H + 20}" fill="#FFF6D0" opacity="0.35" filter="url(#soft)"/><rect x="${(x - 4).toFixed(1)}" y="-10" width="8" height="${H + 20}" fill="#FFFFFF"/>` : ''; }
    }
    if (cut.name === 'smash cut' && dt >= 0 && dt < 0.4) {
      const u = dt / 0.4, k = (1 - u) * (1 - u);
      c.post.push({ s: 1 + 0.14 * EASE.out(1 - Math.min(1, dt / 0.25)), ox: W / 2, oy: H / 2 }, { dx: 26 * k * noise(91, dt, 9), dy: 26 * k * noise(92, dt, 11) });
      if (dt < 0.1) r.fx = `<rect x="-50" y="-50" width="${W + 100}" height="${H + 100}" fill="#FFFFFF" opacity="${(0.85 * (1 - dt / 0.1)).toFixed(3)}"/>`;
    }
    return r;
  }
  // frames that need more motion-blur subframes than the default
  function kFor(scenes, T) {
    let k = 0;
    scenes.forEach(x => {
      if (x.cut && x.cut.name === 'whip pan' && Math.abs(T - x.sc.b) < 0.3) k = Math.max(k, 20);
      if (x.cut && x.cut.name === 'smash cut' && T >= x.sc.b && T < x.sc.b + 0.35) k = Math.max(k, 10);
      if (x.cut && (x.cut.name === 'flip' || x.cut.name === 'shape transition' || x.cut.name === 'liquid transition' || (x.cut.name === 'zoom through' && x.cut.into)) && Math.abs(T - x.sc.b) < 0.4) k = Math.max(k, 12);
      if (T >= x.sc.a && T < x.sc.b) for (const m of x.cam) { if (m.name === 'fpv') k = Math.max(k, 12); if (m.name === 'tracking shot' || m.name === 'orbit' || m.name === 'pan') k = Math.max(k, 8); }
    });
    return k;
  }
  return { m3, aff3, inv3, ap3, layerHomog, flipHomog, NEWCUT, glitchAt, F, VOCAB, EASE, norm, parseCam, parseCut, camAt, timeAt, project, toWorld, layerMatrix, postMatrix, mul, apply, blurPx, cutWindow, cutOut, cutIn, kFor, noise };
})();
if (typeof module !== 'undefined') module.exports = MOVES;
