# Writing scenes

A project is a folder with `project.json` and `index.html`. The page sets a few globals, loads the engine, then defines
its scenes. Every frame is a pure function of time: no `Math.random`, no wall clock, no state carried between frames.
Use seeded noise (see `hs()` in the demo) wherever you want variation.

```html
<script>window.W = 1920; window.H = 1080; window.FPS = 30; window.END = 8;</script>
<script src="../../engine/comp.js"></script><script src="../../engine/moves.js"></script><script src="../../engine/fx.js"></script>
<script src="spec.js"></script><script src="../../engine/engine.js"></script>
<script>
const SC = [ /* scenes */ ];
</script>
```

`spec.js` is written by `tools/build.py` from the `scenes` in `project.json` (camera moves, cuts and fx by name). The page
still loads without it.
With `music` set, `build.py` also writes `beats.js` (`BEATS`, the measured beat times, and `CUTS`, your planned cuts
snapped to the beat); load it before your scene script to time hits and scene windows on the music.

## Page globals (all optional except `SC`)

| global | default | what |
|---|---|---|
| `W`, `H`, `FPS`, `END` | 1080, 1920, 30, 10 | frame size, frame rate, last second; keep them equal to `project.json` |
| `SC` | required | the scenes, in order |
| `DEFS` | none | an SVG `<defs>` string: your gradients, clip paths, filters |
| `OVERLAY(t)` | none | SVG drawn over every scene (a watermark, a progress bar) |
| `CAPTIONS` | none | `[[start, end, text], ...]` in seconds, centred on `SAFE.cx` at `CAPTION_Y` |
| `PALETTE` | built-in | overrides `C.yellow`, `C.coral`, `C.teal`, `C.purple`, `C.white`, `C.ink`, `C.navy`, `C.green`, `C.gold` |
| `FONT` | Inter, Helvetica Neue, Arial | CSS font-family for all text |
| `BG` | `#000` | colour behind everything |
| `SAFE` | 6% / 7% margins | the box where text must read on every player: `{x0, y0, x1, y1, cx}`; `tools/qc.py` checks it (decoration meant to sit outside: `data-noqc="1"` on its `<text>`) |
| `POST` | `{grain: 0.025, ca: 2.2, vig: 0.18, bloom: 0.55}` | the post pass: film grain, chromatic aberration (px), vignette, bloom |

## A scene

```js
{
  a: 2.0, b: 4.0,                                  // its window in seconds
  anchors: { ring: { layer: 'mid', x: 1440, y: 540, r: 150 } },   // named points: camera subjects, match cuts, zoom-through holes
  depth: { fg: 2.5 },                              // optional: override a layer's depth
  cam: ..., cut: ..., fx: ...,                     // optional: inline spec, overrides project.json for this scene
  layers: {
    sky: (t, info) => svg,                         // drawn far away (depth 1000): barely moves
    bg:  (t, info) => svg,                         // depth 20
    mid: (t, info) => svg,                         // depth 6: where the subject usually lives
    fg:  (t, info) => svg,                         // depth 3: moves the most under parallax
  },
}
```

Each layer returns an SVG string drawn in rest-screen pixels (0..W, 0..H as if the camera were at rest). The engine
projects every layer through the scene's camera, so parallax, orbit and dolly zoom come out of the geometry. Draw backgrounds
bigger than the frame (the demo's skies are 5920 x 4080 px) so camera moves never show an edge.

`t` is absolute time in seconds after any time effect (slow motion, freeze frame). `info` carries `{cam, rate, lt, layer}`:
`lt` is time since the scene started, `rate` the current time rate.

A scene without depth can use `draw: t => svg` instead of `layers`: one flat card at mid depth. Pans, zooms, handheld and
every cut still work; parallax does not.

Order of layers: `order: ['sky', 'bg', 'mid', 'fg']` by default.

## Drawing an element with fx

```js
mid: t => fxEl('num', { x: 260, y: 330, w: 760, h: 260 }, F =>
  `<text x="640" y="560" font-size="250" font-weight="900" fill="${C.yellow}" text-anchor="middle">${F['count-up'] ? F['count-up'].text : '0'}</text>`)
```

`fxEl(target, box, draw)` looks up the scene's fx aimed at `target`, applies the transform-like ones (pop-in, mask reveal,
shake, sweep, glitch...) around `box` (`{x, y, w, h, rx}` in the layer's pixels), and hands the content ones to `draw(F)`.
For text that types or moves by character, use `fxText(F, str, x, y, size, attrs, anchor)`.

## Helpers in scope

`clamp`, `sm` (smoothstep), `oc` (ease-out cubic), `ob` (ease-out back), `pop(t, t0, d)`, `life(t, a, b)` (in/out envelope),
`fade(t, a, b)`, `g(x, y, s, inner)` (translate + scale group), `txt(x, y, size, str, fill, weight, anchor)`, the palette `C`,
and the filters `url(#bigBlur)` and `url(#glowE)`.

## Checking your work

- `python3 tools/build.py <project> --preview` renders frame 0, one frame per second and each planned cut (from
  `cuts` in `project.json`) at -0.15 / 0 / +0.15 s, then tiles them into `preview/contact.png`. Look at it before a full
  render.
- Open `index.html` in a browser and call `renderAt(t)` in the console to see one moment as plain SVG (no blur, no post).
- A page error stops the render with the message and the frame number.
