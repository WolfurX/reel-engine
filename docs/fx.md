# Element fx

Element fx animate one named element inside a scene. The scene lists them by name, each with a `target`:

```json
"fx": [
  {"fx": "count-up", "target": "num", "from": 0, "to": 99, "at": 0.2, "dur": 0.8},
  {"fx": "pop-in", "target": "badge", "at": 1.1, "strength": "strong"}
]
```

and the layer draws that element through `fxEl(target, box, draw)`; see [scenes.md](scenes.md). Transform-like fx
(pop-in, mask reveal, squash and stretch, shake, trail, sweep, glitch...) are applied by the engine, so `draw` only draws
content. Content fx (typewriter, count-up, line draw, shape morph...) hand their state to `draw(F)`.

Common params: `at` (s after the scene starts), `dur` (s), `ease`, `strength` (`soft | normal | strong` or a number).
Unknown names, eases and strengths stop `build.py` before any render. A transition written as an fx is refused with a
pointer to the scene's `cut`.

| name | params beyond the common ones | state handed to `draw(F)` |
|---|---|---|
| `pop-in` | strength scales the overshoot | |
| `stagger` | `n`, `gap` (0.08 s), `of` grow / rise / pop | `F.stagger.items[i]` = `{op, s, sy, dy}` per item; pass `n` to `fxEl(target, box, draw, n)` |
| `burst` | `count` (12), `radius` (120), `colors` | |
| `line draw` | | `F['line draw'].draw` 0..1 (use `pathLength="1"` dashes) |
| `mask reveal` | `dir` = where it comes from (up) | |
| `typewriter` | `text`, `cps` (16); caret blinks when done | render with `fxText(F, str, x, y, size)` |
| `count-up` | `from`, `to`, `decimals`, `sep`, `prefix`, `suffix` | `F['count-up'].text` |
| `kinetic typography` | `text` (`"a / b c / d"` splits on slashes), `style` stamp / bounce / spin / stretch / wave, `beat` (0.5 s) | render with `fxText` |
| `easing` | `dist`, `dir` | |
| `overshoot` | `from`, `to`, `prop` rotate / scale / x / y, `pivot` | `F.overshoot.value` |
| `squash & stretch` | `height`, `bounces`, `rest` | |
| `shape morph` | `shapes` circle / square / star / heart / triangle / hexagon / diamond, `hold`, `spin` | `F['shape morph'].pts` (unit points); draw them with `fxPath(pts, cx, cy, r)` |
| `liquid motion` | `dist`, `dir`, `seed`; metaball body with trailing drops | |
| `motion trail` | `path` arc / line / loop, `count`, `gap` | |
| `particles` | `count` (16), `size` (54), `spread`, `gravity`, `colors`, `outline`, `dir` | |
| `parallax` | becomes a `tracking shot` on the 2.5D camera (`amount` world units) | |
| `light sweep` | `width`, `angle`; clipped to the box (`rx`) | |
| `glitch` | slices and RGB split, seeded per 1/24 s (also a cut) | |
| `impact shake` | `drop` (0.22 s), REQUIRES `target`: the screen shakes only when that target lands | |

Everything is seeded: particles, glitch and shake render the same frames every time.

`EFX.events(item)` returns the timed events of one parsed fx (each key of a typewriter, the start and end of a count-up,
each arrival of a shape morph...), so a sound can be put on each one.
