// engine.js: the scene runtime of reel-engine. A page defines SC (its scenes) and optionally CAPTIONS, DEFS, OVERLAY,
// PALETTE, FONT, FPS, SAFE, POST before loading comp.js, moves.js, fx.js and this file. Every frame is a pure function
// of time: svgAt(t) returns the whole picture as SVG, renderFrame(i, K) rasterises K subframes of it and accumulates them
// in the WebGL2 compositor (motion blur), then the post pass adds bloom, chromatic aberration, vignette and grain.
// Scene API: docs/scenes.md. Camera moves and cuts: moves.js. Element fx: fx.js.
'use strict';
if (typeof SPEC === 'undefined') window.SPEC = { scenes: [] };   // optional spec.js from tools/build.py (scenes in project.json)

const W = window.W || 1080, H = window.H || 1920, FPS = window.FPS || 30, END = window.END || 10.0;
const FONT = window.FONT || "'Inter','Helvetica Neue',Arial,sans-serif";
const C = Object.assign({ yellow: '#FFD23F', gold: '#F5B83D', coral: '#FF6B6B', teal: '#2EC4B6', purple: '#8E7DFF', white: '#F4F2FF', ink: '#11132B', navy: '#1C2150', green: '#52E3A4' }, window.PALETTE || {});
const clamp = x => Math.max(0, Math.min(1, x));
const sm = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const oc = x => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
const ob = x => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const pop = (t, t0, d = 0.38) => ob((t - t0) / d);
// in/out envelope for an element living from a to b
const life = (t, a, b, fi = 0.3, fo = 0.25) => Math.min(ob((t - a) / fi), 1 - sm((t - (b - fo)) / fo));
const fade = (t, a, b, fi = 0.25, fo = 0.25) => Math.min(sm((t - a) / fi), 1 - sm((t - (b - fo)) / fo));
const g = (x, y, s, inner, extra = '') => `<g transform="translate(${x} ${y}) scale(${Math.max(0, s)})" ${extra}>${inner}</g>`;
const txt = (x, y, size, str, fill = C.white, w = 800, anchor = 'middle', extra = '') => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}" ${extra}>${str}</text>`;

// safe box: where text reads on every player (captions centre on SAFE.cx)
const SAFE = Object.assign({ x0: W * 0.06, y0: H * 0.07, x1: W * 0.94, y1: H * 0.93, cx: W / 2 }, window.SAFE || {});

const DEPTH = { sky: 1000, bg: 20, mid: 6, fg: 3 };
let SCX = null;
function scenesInit() {
  if (SCX) return SCX;
  const spec = (typeof SPEC !== 'undefined' && SPEC.scenes) || [];
  SCX = SC.map((sc, i) => {
    const s = spec[i] || {}, where = `scene ${i + 1}`;
    let camSpec = sc.cam !== undefined ? sc.cam : s.cam; const cutSpec = sc.cut !== undefined ? sc.cut : s.cut;
    const fx = EFX.parse(sc.fx !== undefined ? sc.fx : s.fx, where + ' fx');
    // fx "parallax" IS the 2.5D camera: it becomes a tracking shot, so the layers separate by their depth
    const par = fx.filter(f => f.name === 'parallax').map(f => Object.assign({}, f.p, { move: 'tracking shot', fx: undefined }));
    if (par.length) camSpec = [].concat(camSpec === undefined || camSpec === null ? [] : camSpec, par);
    const cut = i < SC.length - 1 ? MOVES.parseCut(cutSpec === undefined ? 'zoom through' : cutSpec, where + ' cut') : null;
    const A = sc.anchors || {}, an = cut && (cut.into || cut.from);   // a cut that opens from an anchor (mask transition from the sun, zoom through into the O)
    if (an) { if (!A[an]) throw new Error(`${where} cut: anchor "${an}" not defined (have: ${Object.keys(A).join(', ') || 'none'})`);
      if (cut.x === undefined) cut.x = A[an].x; if (cut.y === undefined) cut.y = A[an].y; if (cut.r === undefined && A[an].r) cut.r = A[an].r; }
    return { sc, i, fx, cam: MOVES.parseCam(camSpec, where + ' cam'), cut };
  });
  return SCX;
}
function sceneCtx(x) {
  const sc = x.sc, depth = Object.assign({}, DEPTH, sc.depth || {}), A = sc.anchors || {};
  const name = (x.cam.find(m => m.p.subject) || {}).p?.subject || (A.subject ? 'subject' : null);
  if (name && !A[name]) throw new Error(`scene ${x.i + 1}: subject "${name}" has no anchor (have: ${Object.keys(A).join(', ') || 'none'})`);
  const an = name ? A[name] : null, Z = an ? (typeof an.layer === 'number' ? an.layer : depth[an.layer || 'fg']) : depth.fg;
  return { depth, W, H, subj: an ? MOVES.toWorld(an.x, an.y, Z, W, H) : null, subjScreen: an ? [an.x, an.y] : null };
}
// the camera of scene x at time t, cut effects included (used for drawing and for match-cut alignment)
function sceneCam(x, t) {
  const sc = x.sc, X = SCX, c = MOVES.camAt(x.cam, t - sc.a, sc.b - sc.a, x.ctx || (x.ctx = sceneCtx(x)));
  const r = { op: 1, clip: '', fx: '', edge: '' };
  if (x.cut) { const o = MOVES.cutOut(x.cut, sc.b - t, c, W, H); r.op = o.op;
    if (o.pre) r.pre = o.pre; if (o.fx) r.fx = o.fx; if (o.glitch) r.glitch = o.glitch; if (o.round) r.round = o.round; if (o.persp) r.persp = o.persp; }
  const cin = x.i ? X[x.i - 1].cut : null;
  if (cin) { const q = MOVES.cutIn(cin, t - sc.a, c, W, H, x.i); r.op = Math.min(r.op, q.op); Object.assign(r, { clip: q.clip, clipId: q.clipId, fx: (r.fx || '') + q.fx, edge: q.edge });
    if (q.glitch) r.glitch = q.glitch; if (q.round) r.round = q.round;
    if (q.pre) r.pre = (r.pre || '') + q.pre; if (q.under) r.under = q.under; if (q.persp) r.persp = q.persp; }
  if (cin && cin.name === 'match cut') c.post.push(...matchOps(x));
  return { c, r };
}
// match cut: reframe the incoming scene so its anchor lands on the outgoing anchor's screen position and size at the cut
function matchOps(x) {
  if (x.match) return x.match;
  const prev = SCX[x.i - 1], cut = prev.cut; x.match = [];
  if (!cut.match) return x.match;
  const at = (y, name, t) => { const an = (y.sc.anchors || {})[name]; if (!an) throw new Error(`match cut: scene ${y.i + 1} has no anchor "${name}"`);
    const ctx = y.ctx || (y.ctx = sceneCtx(y)), Z = typeof an.layer === 'number' ? an.layer : ctx.depth[an.layer || 'fg'];
    const c = MOVES.camAt(y.cam, t - y.sc.a, y.sc.b - y.sc.a, ctx);
    if (y === prev) { MOVES.cutOut(cut, 0, c, W, H); if (y.i && SCX[y.i - 1].cut && SCX[y.i - 1].cut.name === 'match cut') c.post.push(...matchOps(y)); }
    const M = MOVES.mul(MOVES.postMatrix(c, W, H), MOVES.layerMatrix(c, Z, W, H).m), p = MOVES.apply(M, an.x, an.y), q = MOVES.apply(M, an.x + (an.r || 50), an.y);
    return [p[0], p[1], Math.hypot(q[0] - p[0], q[1] - p[1])]; };
  const A = at(prev, cut.match[0], prev.sc.b), B = at(x, cut.match[1], x.sc.a), s = A[2] / B[2];
  x.match = [{ s, ox: B[0], oy: B[1], dx: A[0] - B[0], dy: A[1] - B[1] }];
  return x.match;
}
let FRAME_INFO = {};
function sceneSvg(x, t) {
  const sc = x.sc, { c, r } = sceneCam(x, t), ti = MOVES.timeAt(x.cam, t - sc.a, sc.b - sc.a), tau = sc.a + ti.tau, ctx = x.ctx;
  FXNOW = { list: x.fx, lt: tau - sc.a, scene: x.i };   // what fxEl() reads while this scene's layers draw
  const shake = x.fx.length ? EFX.screen(x.fx, tau - sc.a) : null;   // impact shake moves the whole picture
  if (shake) c.post.push({ rot: shake.rot, ox: W / 2, oy: H / 2 }, { dx: shake.dx, dy: shake.dy });
  const post = MOVES.postMatrix(c, W, H), f6 = v => v.toFixed(5), f2 = v => v.toFixed(2);
  const mtx = M => `matrix(${f6(M[0])} ${f6(M[1])} ${f6(M[2])} ${f6(M[3])} ${f2(M[4])} ${f2(M[5])})`;
  let s = '';
  // an orbit (or a scene with persp: true) draws each card through its exact homography (warp node), so it keystones
  const P3 = x.persp3 !== undefined ? x.persp3 : (x.persp3 = !!(sc.persp || x.cam.some(m => m.name === 'orbit')));
  if (sc.layers) {
    for (const L of sc.order || ['sky', 'bg', 'mid', 'fg']) {
      const fn = sc.layers[L]; if (!fn) continue;
      const Z = ctx.depth[L], lm = MOVES.layerMatrix(c, Z, W, H); if (lm.dist < 0.3) continue;
      const lop = lm.dist < 0.8 ? (lm.dist - 0.3) / 0.5 : 1, bl = L === 'sky' ? 0 : MOVES.blurPx(c, lm.dist);
      if (P3) { let inner = fn(tau, { cam: c, carryPx: c.carry * MOVES.F / Z, subjYaw: c.subjYaw, rate: ti.rate, lt: t - sc.a, t, layer: L });
        if (bl > 0.4) { const id = `mvb${x.i}${L}`; inner = `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="${-W}" y="${-H}" width="${3 * W}" height="${3 * H}"><feGaussianBlur stdDeviation="${bl.toFixed(2)}"/></filter></defs><g filter="url(#${id})">${inner}</g>`; }
        s += warpNode(inner, { H: MOVES.m3(MOVES.aff3(post), MOVES.layerHomog(c, Z, W, H)), op: lop }); continue; }
      let inner = `<g transform="${mtx(MOVES.mul(post, lm.m))}">${fn(tau, { cam: c, carryPx: c.carry * MOVES.F / Z, subjYaw: c.subjYaw, rate: ti.rate, lt: t - sc.a, t, layer: L })}</g>`;
      if (bl > 0.4) { const id = `mvb${x.i}${L}`; s += `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="-80" y="-80" width="${W + 160}" height="${H + 160}"><feGaussianBlur stdDeviation="${bl.toFixed(2)}"/></filter></defs>`; inner = `<g filter="url(#${id})">${inner}</g>`; }
      s += lop < 1 ? `<g opacity="${lop.toFixed(3)}">${inner}</g>` : inner;
    }
  } else if (P3) s = warpNode(sc.draw(tau), { H: MOVES.m3(MOVES.aff3(post), MOVES.layerHomog(c, ctx.depth.mid, W, H)) });
  else s = `<g transform="${mtx(MOVES.mul(post, MOVES.layerMatrix(c, ctx.depth.mid, W, H).m))}">${sc.draw(tau)}</g>`;
  if (ti.flash > 0) s += `<rect x="-50" y="-50" width="${W + 100}" height="${H + 100}" fill="#FFFFFF" opacity="${(0.8 * ti.flash).toFixed(3)}"/>`;
  s += r.fx || '';
  FRAME_INFO = { scene: x.i, rate: ti.rate, frozen: ti.frozen, cam: c };
  if (P3 || r.persp) {   // the scene becomes one warp node (its own canvas): opacity, round corners, the cut's clip and the flip apply to the whole picture
    const node = { H: r.persp ? r.persp.H : null, op: r.op };
    if (r.round > 0.5) node.preMask = `<rect x="0" y="0" width="${W}" height="${H}" rx="${r.round.toFixed(1)}" transform="${mtx(post)}" fill="#fff"/>`;
    if (r.clipId) node.mask = `${r.clip}<rect x="-50" y="-50" width="${W + 100}" height="${H + 100}" fill="#fff" clip-path="url(#${r.clipId})"/>`;
    return `${r.pre || ''}${r.clipId ? '' : r.clip}${r.under || ''}${warpNode(s, node)}${r.edge}`;
  }
  if (r.glitch && r.op > 0) s = glitchSvg(s, r.glitch, `gx${x.i}`, { x: -40, y: -40, w: W + 80, h: H + 80 });
  if (r.round > 0.5) { const id = `rnd${x.i}`; s = `<defs><clipPath id="${id}"><rect x="0" y="0" width="${W}" height="${H}" rx="${r.round.toFixed(1)}" transform="${mtx(post)}"/></clipPath></defs><g clip-path="url(#${id})">${s}</g>`; }
  return `${r.pre || ''}${r.clip}${r.under || ''}<g opacity="${r.op.toFixed(3)}"${r.clipId ? ` clip-path="url(#${r.clipId})"` : ''}>${s}</g>${r.edge}`;
}
function frame(t) {
  const X = scenesInit(), tb = typeof window.T_BASE === 'number' ? window.T_BASE : t; let out = '';
  X.forEach((x, i) => {
    const pre = i ? MOVES.cutWindow(X[i - 1].cut)[0] : 0, post = x.cut ? MOVES.cutWindow(x.cut)[1] : 0;
    if (tb < x.sc.a - pre || tb >= x.sc.b + post) return;
    out += sceneSvg(x, t);
  });
  return out;
}
window.kAt = T => MOVES.kFor(scenesInit(), T);

// ---------- element fx renderer: fx.js gives numbers, these turn them into SVG ----------
// A scene draws a named element with fxEl(target, box, draw): box = {x, y, w, h} in the layer's px (rx for light sweep),
// draw(F) returns the element's SVG, where F[name] = that fx's state (typewriter chars, count-up text, line draw fraction,
// shape morph points...). Transform-like fx (pop-in, mask reveal, easing, squash & stretch, impact shake, burst, motion
// trail, particles, light sweep, glitch, overshoot with prop) are applied here, so a scene only draws content.
let FXNOW = { list: [], lt: 0, scene: -1 };
const fxN = v => (+v).toFixed(2);
// two fx of one name on one target (two light sweeps): the one that started most recently wins, the first one before any starts
function fxStates(target, n) { const F = {}; for (const f of EFX.on(FXNOW.list, target, FXNOW.lt, { n })) { const o = F[f.name], at = f.p.at || 0;
  if (!o || (at <= FXNOW.lt && at >= (o.p.at || 0))) F[f.name] = Object.assign({ p: f.p }, f.st); } return F; }
const FX_RGB = id => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/><feOffset in="r" dx="DX" result="r2"/><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb"/><feOffset in="gb" dx="-DX" result="gb2"/><feBlend in="r2" in2="gb2" mode="screen"/></filter>`;
// glitch: the element drawn as horizontal slices shifted sideways + an RGB split; box in the same px as inner
function glitchSvg(inner, G, id, b) {
  const split = Math.abs(G.split || 0); let s = `<defs>${FX_RGB(id).replace(/DX/g, fxN(split))}`;
  G.slices.forEach((q, k) => { s += `<clipPath id="${id}c${k}"><rect x="${fxN(b.x - 400)}" y="${fxN(b.y + b.h * q.y0)}" width="${fxN(b.w + 800)}" height="${fxN(b.h * (q.y1 - q.y0))}"/></clipPath>`; });
  s += `<clipPath id="${id}m"><path fill-rule="evenodd" d="M ${b.x - 400} ${b.y - 400} h ${b.w + 800} v ${b.h + 800} h ${-(b.w + 800)} Z ${G.slices.map(q => `M ${fxN(b.x - 400)} ${fxN(b.y + b.h * q.y0)} h ${b.w + 800} v ${fxN(b.h * (q.y1 - q.y0))} h ${-(b.w + 800)} Z`).join(' ')}"/></clipPath></defs>`;
  const body = `<g clip-path="url(#${id}m)">${inner}</g>` + G.slices.map((q, k) => `<g clip-path="url(#${id}c${k})"><g transform="translate(${fxN(q.dx)} 0)">${inner}</g></g>`).join('');
  return s + (split > 0.3 ? `<g filter="url(#${id})"${G.skew ? ` transform="skewX(${fxN(G.skew)})"` : ''}>${body}</g>` : body);
}
let FXID = 0;
function fxEl(target, box, draw, n) {
  const F = fxStates(target, n), cx = box.x + box.w / 2, cy = box.y + box.h / 2, bot = box.y + box.h, id = `fx${FXNOW.scene}${target.replace(/\W/g, '')}${FXID++ % 100000}`;
  let s = draw(F), op = 1;
  const at = (k, inner) => k.dx || k.dy ? `<g transform="translate(${fxN(k.dx || 0)} ${fxN(k.dy || 0)})">${inner}</g>` : inner;
  if (F['light sweep'] && F['light sweep'].op > 0) { const L = F['light sweep'], x = box.x + box.w * L.pos, bw = box.w * L.width;
    s += `<defs><clipPath id="${id}ls"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.rx || 0}"/></clipPath><linearGradient id="${id}lg" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="${fxN(0.85 * L.op)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <g clip-path="url(#${id}ls)"><rect x="${fxN(x - bw / 2)}" y="${box.y - box.h}" width="${fxN(bw)}" height="${box.h * 3}" fill="url(#${id}lg)" transform="skewX(${-L.angle}) translate(${fxN(Math.tan(L.angle * Math.PI / 180) * cy)} 0)"/><rect x="${fxN(x + bw * 0.42)}" y="${box.y - box.h}" width="${fxN(bw * 0.12)}" height="${box.h * 3}" fill="#fff" opacity="${fxN(0.5 * L.op)}" transform="skewX(${-L.angle}) translate(${fxN(Math.tan(L.angle * Math.PI / 180) * cy)} 0)"/></g>`; }
  if (F['glitch'] && F['glitch'].on) { s = glitchSvg(s, F['glitch'], id + 'g', box); op *= F['glitch'].op; }
  if (F['overshoot'] && F['overshoot'].p.prop) { const o = F['overshoot'], P = o.p.prop, pv = o.p.pivot || [cx, cy];
    if (P === 'rotate') s = `<g transform="rotate(${fxN(o.value)} ${pv[0]} ${pv[1]})">${s}</g>`;
    else if (P === 'scale') s = `<g transform="translate(${pv[0]} ${pv[1]}) scale(${fxN(Math.max(0, o.value))}) translate(${-pv[0]} ${-pv[1]})">${s}</g>`;
    else if (P === 'x' || P === 'y') s = at(P === 'x' ? { dx: o.value } : { dy: o.value }, s);
    else throw new Error(`overshoot: prop "${P}" (rotate, scale, x, y)`); }
  if (F['squash & stretch']) { const q = F['squash & stretch']; s = `<g transform="translate(${cx} ${fxN(bot + q.dy)}) scale(${fxN(q.sx)} ${fxN(q.sy)}) translate(${-cx} ${-bot})">${s}</g>`; }
  if (F['impact shake']) { const q = F['impact shake']; op *= q.op; s = `<g transform="translate(${cx} ${bot}) scale(${fxN(q.s * q.sx)} ${fxN(q.s * q.sy)}) translate(${-cx} ${-bot})">${s}</g>`; }
  if (F['burst']) { const q = F['burst'], col = q.p.colors || [C.yellow, C.coral, C.white]; let rays = '';
    for (const r of q.rays) if (r.op > 0) rays += `<line x1="${fxN(cx + r.r0 * Math.cos(r.a))}" y1="${fxN(cy + r.r0 * Math.sin(r.a))}" x2="${fxN(cx + r.r1 * Math.cos(r.a))}" y2="${fxN(cy + r.r1 * Math.sin(r.a))}" stroke="${col[0]}" stroke-width="${fxN(r.w)}" stroke-linecap="round" opacity="${fxN(r.op)}"/>`;
    for (const d of q.dots) if (d.op > 0 && d.r > 0.2) rays += `<circle cx="${fxN(cx + d.x)}" cy="${fxN(cy + d.y)}" r="${fxN(d.r)}" fill="${col[d.c % col.length]}" opacity="${fxN(d.op)}"/>`;
    s = rays + `<g transform="translate(${cx} ${cy}) scale(${fxN(q.s)}) translate(${-cx} ${-cy})">${s}</g>`; op *= q.op; }
  if (F['pop-in']) { const q = F['pop-in']; op *= q.op; s = `<g transform="translate(${cx} ${cy}) scale(${fxN(q.s)}) translate(${-cx} ${-cy})">${s}</g>`; }
  if (F['easing']) s = at(F['easing'], s);
  if (F['motion trail']) { const q = F['motion trail']; let tr = '';
    for (let k = q.trail.length - 1; k >= 0; k--) { const c = q.trail[k]; tr += `<g opacity="${fxN(c.op)}" transform="translate(${fxN(cx + c.dx)} ${fxN(cy + c.dy)}) scale(${fxN(c.s)}) translate(${-cx} ${-cy})">${s}</g>`; }
    s = tr + at(q, s); }
  if (F['mask reveal']) { const q = F['mask reveal'], pad = box.pad !== undefined ? box.pad : 30;
    s = `<defs><clipPath id="${id}mr"><rect x="${box.x - pad}" y="${box.y - pad}" width="${box.w + 2 * pad}" height="${box.h + 2 * pad}"/></clipPath></defs><g clip-path="url(#${id}mr)">${at({ dx: q.ox * (box.w + 2 * pad), dy: q.oy * (box.h + 2 * pad) }, s)}</g>`; }
  if (F['particles']) { const q = F['particles'], col = q.p.colors || [C.yellow, C.coral, C.teal, C.purple, C.green], ink = q.p.outline || C.ink; let ps = '';   // big pieces, ink outline
    for (const d of q.parts) if (d.op > 0.01 && d.r > 0.5) { const R = d.r, f = col[d.c % col.length], st = `fill="${f}" stroke="${ink}" stroke-width="${fxN(Math.max(3, R * 0.15))}" stroke-linejoin="round" paint-order="stroke"`;
      ps += `<g transform="translate(${fxN(cx + d.x)} ${fxN(cy + d.y)}) rotate(${fxN(d.rot)}) scale(1 ${fxN(d.flip)})" opacity="${fxN(d.op)}">` + (d.shape === 0 ? `<circle r="${fxN(R * 0.5)}" ${st}/>`
        : d.shape === 1 ? `<rect x="${fxN(-R * 0.62)}" y="${fxN(-R * 0.34)}" width="${fxN(R * 1.24)}" height="${fxN(R * 0.68)}" rx="${fxN(R * 0.12)}" ${st}/>`
        : d.shape === 2 ? `<path d="M 0 ${fxN(-R * 0.64)} L ${fxN(R * 0.6)} ${fxN(R * 0.42)} L ${fxN(-R * 0.6)} ${fxN(R * 0.42)} Z" ${st}/>`
        : `<path d="${Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 5, rr = R * (k % 2 ? 0.3 : 0.68); return `${k ? 'L' : 'M'} ${fxN(rr * Math.cos(a))} ${fxN(rr * Math.sin(a))}`; }).join(' ')} Z" ${st}/>`) + '</g>'; }
    s += ps; }
  return op < 0.999 ? `<g opacity="${fxN(Math.max(0, op))}">${s}</g>` : s;
}
// glyph advances measured on a canvas in the page's own font (prefix widths, so kerning counts); the old
// width table only when there is no DOM. Returns x of each glyph boundary, [0, ..., total].
let FX_MCTX = null; const FX_MW = {};
function fxMeasure(str, size, weight = 800) {
  const key = `${weight}|${size}|${str}`; if (FX_MW[key]) return FX_MW[key];
  const xs = [0];
  if (typeof document === 'undefined') { for (const ch of str) xs.push(xs[xs.length - 1] + FX_ADV(ch) * size); return xs; }
  if (!FX_MCTX) FX_MCTX = document.createElement('canvas').getContext('2d');
  FX_MCTX.font = `${weight} ${size}px ${FONT}`;
  for (let i = 1; i <= str.length; i++) xs.push(FX_MCTX.measureText(str.slice(0, i)).width);
  return (FX_MW[key] = xs);
}
// liquid motion as liquid. Body + drops in ONE gooey group (blur + alpha threshold = metaballs: drops neck and
// merge with the body), then lit (specular on the goo's own height) over a radial body shade. q = F['liquid motion'], (x, y) = rest centre.
function fxLiquid(q, x, y, col, id, groundY) {
  const R = q.R, X = x + q.dx, Y = y + q.dy, hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), mix = (a, b, k) => '#' + hx(a).map((v, i) => Math.round(v + (hx(b)[i] - v) * k).toString(16).padStart(2, '0')).join('');
  const lite = mix(col, '#FFFFFF', 0.45), dark = mix(col, '#0B0D1E', 0.4), fx0 = x - 1100, fy0 = y - 900;
  let s = `<defs><radialGradient id="${id}rg" cx="0.38" cy="0.32" r="0.78"><stop offset="0" stop-color="${lite}"/><stop offset="0.55" stop-color="${col}"/><stop offset="1" stop-color="${dark}"/></radialGradient>
    <filter id="${id}g" filterUnits="userSpaceOnUse" x="${fx0}" y="${fy0}" width="2200" height="1600" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${fxN(R * 0.13)}" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 30 -13" result="goo"/>
      <feGaussianBlur in="goo" stdDeviation="${fxN(R * 0.09)}" result="gb"/>
      <feSpecularLighting in="gb" surfaceScale="${fxN(R * 0.06)}" specularConstant="1.05" specularExponent="24" lighting-color="#FFFFFF" result="sp"><feDistantLight azimuth="225" elevation="50"/></feSpecularLighting>
      <feComposite in="sp" in2="goo" operator="in" result="spi"/><feComposite in="spi" in2="goo" operator="arithmetic" k1="0" k2="0.8" k3="1" k4="0"/></filter></defs>`;
  if (groundY !== undefined) s += `<ellipse cx="${fxN(X)}" cy="${fxN(groundY)}" rx="${fxN(R * (1.15 + 0.15 * q.v))}" ry="${fxN(R * 0.14)}" fill="#000" opacity="0.3" filter="url(#soft)"/>`;
  s += `<g filter="url(#${id}g)"><path d="${fxPath(q.pts, X, Y, R)}" fill="url(#${id}rg)"/>${q.drops.map(d => `<circle cx="${fxN(X + d.x)}" cy="${fxN(Y + d.y)}" r="${fxN(Math.max(0, d.r))}" fill="url(#${id}rg)"/>`).join('')}</g>`;
  return s;
}
// unit points (fx.js shape morph / liquid motion) -> a closed path at (cx, cy), radius r
function fxPath(pts, cx, cy, r, sx = 1, sy = 1) { return 'M ' + pts.map(([x, y]) => `${fxN(cx + x * r * sx)} ${fxN(cy + y * r * sy)}`).join(' L ') + ' Z'; }
// a text element that follows typewriter (chars + caret) and kinetic typography (per character); a = <text> attributes
const FX_ADV = ch => /[A-Z@#%&MW]/.test(ch) ? (ch === 'I' ? 0.32 : /[MW]/.test(ch) ? 0.9 : 0.68) : /[a-z]/.test(ch) ? (/[il]/.test(ch) ? 0.27 : /[mw]/.test(ch) ? 0.86 : 0.56) : /[0-9]/.test(ch) ? 0.62 : ch === ' ' ? 0.28 : 0.34;
function fxText(F, str, x, y, size, a = '', anchor = 'middle') {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const T = F['typewriter'], K = F['kinetic typography'];
  if (T) { const shown = str.slice(0, T.chars), w = shown.split('').reduce((s, c) => s + FX_ADV(c), 0) * size, x0 = anchor === 'middle' ? x - str.split('').reduce((s, c) => s + FX_ADV(c), 0) * size / 2 : x;
    return `<text x="${fxN(x0)}" y="${y}" font-size="${size}" text-anchor="start" ${a}>${esc(shown)}</text>` + (T.caret ? `<rect x="${fxN(x0 + w + size * 0.06)}" y="${fxN(y - size * 0.82)}" width="${fxN(size * 0.08)}" height="${fxN(size * 0.98)}" rx="${fxN(size * 0.03)}" fill="${(a.match(/fill="([^"]+)"/) || [0, '#fff'])[1]}"/>` : ''); }
  if (K && K.chunks) { let k = K; if (!k.chunks.length && str) k = Object.assign({ p: K.p }, EFX.at({ name: 'kinetic typography', p: Object.assign({}, K.p, { text: str }) }, FXNOW.lt));
    if (k.cur < 0 || !k.text) return '';
    const wt = (a.match(/font-weight="(\d+)"/) || [0, 800])[1], s0 = k.text; let xs = fxMeasure(s0, size, wt);
    const maxW = (k.p && k.p.maxW) || 840, fit = Math.min(1, maxW / Math.max(1, xs[xs.length - 1])), sz = size * fit; xs = xs.map(v => v * fit);
    const x0 = anchor === 'middle' ? x - xs[xs.length - 1] / 2 : x, wh = k.whole, py = y - sz * 0.35; let out = '';
    s0.split('').forEach((ch, i) => { const c = k.chars[i] || {}; if (ch === ' ' || c.op <= 0) return; const mx = x0 + (xs[i] + xs[i + 1]) / 2;
      out += `<text x="0" y="0" font-size="${fxN(sz)}" text-anchor="middle" ${a} opacity="${fxN(c.op)}" transform="translate(${fxN(mx + c.dx)} ${fxN(y + c.dy)}) rotate(${fxN(c.rot)}) scale(${fxN(c.s * c.sx)} ${fxN(c.s * c.sy)})">${esc(ch)}</text>`; });
    return `<g opacity="${fxN(wh.op)}" transform="translate(${x} ${fxN(py)}) rotate(${fxN(wh.rot)}) scale(${fxN(wh.s * wh.sx)} ${fxN(wh.s * wh.sy)}) translate(${-x} ${fxN(-py)})">${out}</g>`; }
  if (K) { const ws = str.split('').map(FX_ADV), tot = ws.reduce((s, v) => s + v, 0) * size, wh = K.whole; let cx = anchor === 'middle' ? x - tot / 2 : x, out = '';
    str.split('').forEach((ch, i) => { const c = K.chars[i] || {}, w = ws[i] * size, mx = cx + w / 2; cx += w; if (ch === ' ' || c.op <= 0) return;
      out += `<text x="0" y="0" font-size="${size}" text-anchor="middle" ${a} opacity="${fxN(c.op)}" transform="translate(${fxN(mx + c.dx)} ${fxN(y + c.dy)}) rotate(${fxN(c.rot)}) scale(${fxN(c.s * c.sx)} ${fxN(c.s * c.sy)})">${esc(ch)}</text>`; });
    return `<g opacity="${fxN(wh.op)}" transform="translate(${x} ${fxN(y - size * 0.35)}) rotate(${fxN(wh.rot)}) scale(${fxN(wh.s * wh.sx)} ${fxN(wh.s * wh.sy)}) translate(${-x} ${fxN(-(y - size * 0.35))})">${out}</g>`; }
  return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" ${a}>${esc(str)}</text>`;
}


// ---------- captions (optional): CAPTIONS = [[start, end, text], ...] in seconds; centred on SAFE.cx at CAPTION_Y ----------
const CAPTION_Y = window.CAPTION_Y || H * 0.68;
function captions(t) {
  if (typeof CAPTIONS === 'undefined') return '';
  const cur = CAPTIONS.find(([a, b]) => t >= a && t < b + 0.12); if (!cur) return '';
  const k = cur[0] === 0 ? 1 : oc((t - cur[0]) / 0.12), fs = Math.min(W * 0.06, (SAFE.x1 - SAFE.x0) * 0.95 / (0.56 * cur[2].length));
  return g(SAFE.cx, CAPTION_Y, 0.92 + 0.08 * k, `<text x="0" y="0" font-size="${fs.toFixed(1)}" font-weight="800" text-anchor="middle" fill="${C.white}" stroke="${C.ink}" stroke-width="${(fs * 0.22).toFixed(1)}" paint-order="stroke" stroke-linejoin="round">${cur[2]}</text>`, `opacity="${k}"`);
}

const DEFS_BASE = `<defs>
  <filter id="bigBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="glowE" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;
window.svgAt = t => { WARPN = []; return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><style>text{font-family:${FONT}}</style>${DEFS_BASE}${typeof DEFS === 'string' ? DEFS : ''}<rect width="${W}" height="${H}" fill="${window.BG || '#000'}"/>${frame(t)}${captions(t)}${typeof OVERLAY === 'function' ? OVERLAY(t) : ''}</svg>`; };
window.renderAt = t => { window.T_BASE = undefined; document.getElementById('root').innerHTML = svgAt(t); };
// each output frame = K subframes across a 180-degree shutter, rasterised from the same SVG and accumulated in the WebGL2
// compositor, then bloom / CA / vignette / grain in the final shader. POST overrides any of them (bloom 0 for paper-white scenes).
const POST = Object.assign({ grain: 0.025, ca: 2.2, vig: 0.18, bloom: 0.55 }, window.POST || {});
let GL = null;
function glInit() {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.id = 'out';
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:10'; document.body.appendChild(cv);
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  document.getElementById('root').style.display = 'none';
  GL = { comp: makeComp(cv), src, ctx: src.getContext('2d') };
}
function loadSvg(s) { return new Promise((ok, bad) => { const im = new Image(); const u = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' })); im.onload = () => { URL.revokeObjectURL(u); ok(im); }; im.onerror = bad; im.src = u; }); }
window.renderFrame = async (i, K = 6) => {
  if (!GL) glInit();
  const T0 = i / FPS, t0 = performance.now();
  K = Math.max(K, window.kAt ? window.kAt(T0) : 0);  // whip pans and other fast frames ask for more subframes
  window.T_BASE = T0;
  GL.comp.begin();
  for (let s = 0; s < K; s++) {
    const svg = svgAt(T0 + (s / K) * (0.5 / FPS));
    if (svg.indexOf('<!--W:') < 0) { const im = await loadSvg(svg); GL.ctx.clearRect(0, 0, W, H); GL.ctx.drawImage(im, 0, 0); }
    else { GL.ctx.clearRect(0, 0, W, H); await drawWarped(svg, GL.ctx); }   // perspective cards
    GL.comp.add(GL.src, 1 / K);
  }
  GL.comp.finish(i, POST);
  return performance.now() - t0;
};

// ---------- warp nodes: a real projective path for flat cards (orbit, flip) ----------
// sceneSvg wraps a card's SVG in <!--W:k--> ... <!--/W:k--> with WARPN[k] = {H (3x3 row-major, child plane -> parent plane),
// op, preMask (child plane), mask (parent plane)}. A frame with no node renders exactly as before (one image). With nodes, the
// frame is split into a tree: every text run is rasterised as its own SVG over the plane window it shows, each node's children
// go to their own canvas, and the canvas is drawn into its parent through the exact homography in a WebGL pass (per-pixel inverse
// map, mipmapped, so the far edge of a card shrinks and the near edge grows: a keystone, which an affine fit cannot do).
let WARPN = [];
function warpNode(inner, node) { const k = WARPN.push(node) - 1; return `<!--W:${k}-->${inner}<!--/W:${k}-->`; }
function warpTree(body) {
  const root = { kids: [] }, st = [root], re = /<!--(\/?)W:(\d+)-->/g; let last = 0, m;
  while ((m = re.exec(body))) { const tx = body.slice(last, m.index); if (tx) st[st.length - 1].kids.push(tx); last = re.lastIndex;
    if (!m[1]) { const n = { node: WARPN[+m[2]], kids: [] }; st[st.length - 1].kids.push(n); st.push(n); } else st.pop(); }
  if (body.slice(last)) root.kids.push(body.slice(last)); return root;
}
const WCANV = {};
function wcanv(key, w, h) { let c = WCANV[key]; if (!c) c = WCANV[key] = document.createElement('canvas'); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h); return [c, x]; }
let WG = null;
function warpGL(src, sv, Hm, dv) {   // src canvas shows plane window sv {x0, y0, w, h, sc}; draw it through Hm into window dv
  const ow = Math.round(dv.w * dv.sc), oh = Math.round(dv.h * dv.sc);
  if (!WG) { const cv = document.createElement('canvas'), gl = cv.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    const sh = (ty, src) => { const o = gl.createShader(ty); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; uniform sampler2D tex; uniform mat3 Hi; uniform vec3 sv; uniform vec3 dv; uniform vec2 tsz; uniform float oh; out vec4 o;
void main() { vec2 f = vec2(gl_FragCoord.x, oh - gl_FragCoord.y); vec3 q = Hi * vec3(dv.xy + f / dv.z, 1.0);
  if (q.z <= 1e-6) { o = vec4(0.0); return; }
  vec2 px = (q.xy / q.z - sv.xy) * sv.z, uv = px / tsz;
  float e = min(min(px.x, tsz.x - px.x), min(px.y, tsz.y - px.y));
  o = e < -1.0 ? vec4(0.0) : texture(tex, uv) * clamp(e + 0.5, 0.0, 1.0); }`)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.useProgram(pr);
    WG = { cv, gl, pr, u: n => gl.getUniformLocation(pr, n) }; }
  const { cv, gl } = WG; if (cv.width !== ow || cv.height !== oh) { cv.width = ow; cv.height = oh; }
  gl.viewport(0, 0, ow, oh); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); gl.generateMipmap(gl.TEXTURE_2D);
  const I = MOVES.inv3(Hm); gl.uniformMatrix3fv(WG.u('Hi'), false, [I[0], I[3], I[6], I[1], I[4], I[7], I[2], I[5], I[8]]);
  gl.uniform3f(WG.u('sv'), sv.x0, sv.y0, sv.sc); gl.uniform3f(WG.u('dv'), dv.x0, dv.y0, dv.sc); gl.uniform2f(WG.u('tsz'), src.width, src.height); gl.uniform1f(WG.u('oh'), oh);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
  return cv;
}
let SVG_HEAD = '';
const leafSvg = (body, v) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(v.w * v.sc)}" height="${Math.round(v.h * v.sc)}" viewBox="${v.x0} ${v.y0} ${v.w} ${v.h}" preserveAspectRatio="none">${SVG_HEAD}${body}</svg>`;
// the window of a node's plane that lands inside the parent window: the parent's corners mapped back (in front of the eye only), padded
function childView(Hm, pv) {
  const I = MOVES.inv3(Hm), pts = []; const N = 4;
  for (let i = 0; i <= N; i++) for (const [a, b] of [[i / N, 0], [i / N, 1], [0, i / N], [1, i / N]]) { const q = MOVES.ap3(I, pv.x0 + a * pv.w, pv.y0 + b * pv.h); if (q[2] > 1e-6) pts.push(q); }
  let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  const px = 0.04 * (x1 - x0) + 8, py = 0.04 * (y1 - y0) + 8;
  x0 = Math.max(-2 * W, x0 - px); x1 = Math.min(3 * W, x1 + px); y0 = Math.max(-1.5 * H, y0 - py); y1 = Math.min(2.5 * H, y1 + py);
  const w = Math.max(16, x1 - x0), h = Math.max(16, y1 - y0), mag = Math.sqrt(Math.abs(Hm[0] * Hm[4] - Hm[1] * Hm[3])) / Math.abs(MOVES.ap3(Hm, (x0 + x1) / 2, (y0 + y1) / 2)[2] || 1);
  const sc = Math.min(1.5, Math.max(0.6, mag), 4096 / w, 4096 / h);
  return { x0: Math.floor(x0), y0: Math.floor(y0), w: Math.ceil(w), h: Math.ceil(h), sc };
}
async function drawKids(kids, ctx, view, depth) {
  for (const k of kids) {
    if (typeof k === 'string') { if (k.trim()) ctx.drawImage(await loadSvg(leafSvg(k, view)), 0, 0); continue; }
    const n = k.node, cv = n.H ? childView(n.H, view) : view;
    const [c2, x2] = wcanv('n' + depth, Math.round(cv.w * cv.sc), Math.round(cv.h * cv.sc));
    await drawKids(k.kids, x2, cv, depth + 1);
    if (n.preMask) { x2.globalCompositeOperation = 'destination-in'; x2.drawImage(await loadSvg(leafSvg(n.preMask, cv)), 0, 0); x2.globalCompositeOperation = 'source-over'; }
    let res = n.H ? warpGL(c2, cv, n.H, view) : c2;
    if (n.mask) { const [c3, x3] = wcanv('m' + depth, Math.round(view.w * view.sc), Math.round(view.h * view.sc)); x3.drawImage(res, 0, 0);
      x3.globalCompositeOperation = 'destination-in'; x3.drawImage(await loadSvg(leafSvg(n.mask, view)), 0, 0); res = c3; }
    ctx.globalAlpha = n.op === undefined ? 1 : Math.max(0, Math.min(1, n.op)); ctx.drawImage(res, 0, 0); ctx.globalAlpha = 1;
  }
}
async function drawWarped(svg, ctx) {
  const open = svg.match(/^<svg[^>]*>/)[0], bi = svg.indexOf(`<rect width="${W}" height="${H}" fill="#000"/>`);
  SVG_HEAD = svg.slice(open.length, bi);
  await drawKids(warpTree(svg.slice(bi, -'</svg>'.length)).kids, ctx, { x0: 0, y0: 0, w: W, h: H, sc: 1 }, 0);
}
