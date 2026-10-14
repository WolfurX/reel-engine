# Camera moves, time effects and cuts

Every scene names its camera move and the cut out of it, in `project.json` (or inline on the scene in `index.html`):

```json
"scenes": [
  {"cam": {"move": "dolly in", "dur": 3, "ease": "inOut", "subject": "hero"}, "cut": "whip pan"},
  {"cam": [{"move": "dolly in", "amount": 0.2}, {"move": "handheld", "amount": 0.6}], "cut": {"name": "match cut", "match": ["sun", "moon"]}},
  {"cam": {"move": "slow motion", "rate": 0.25}, "cut": "j-cut"}
]
```

- `cam` is one move or an array. Camera moves add up; at most one time effect per scene.
- `cut` is the transition OUT of that scene into the next. With no `cut`, the default is `zoom through`.
- Common params: `dur` (s, default the whole scene), `at` (start offset in s), `ease`
  (`linear | in | out | inOut | smooth | back | overshoot | elastic | bounce`), `speed` (`slow | normal | fast` or a number,
  scales the amount), `subject` (an anchor the scene defines), `amount`, `dir`.
- Names are case- and spacing-insensitive, with aliases (`arc shot`, `vertigo`, `dolly out`, `zoom out`, `crane down`,
  `timelapse`, `dissolve`, `hard cut`, `iris`, `card flip`...). Unknown names, eases or speeds stop `build.py` before any
  render, and throw in the page.

## World model

A scene is flat cards at depths (`sky` 1000, `bg` 20, `mid` 6, `fg` 3 by default, override per scene with `depth`), each
drawn in rest-screen pixels. The camera is a real 3D camera (x, y, z, yaw, pitch, roll, zoom) projected onto each card, so
parallax, orbit, crane and dolly zoom come from geometry, not per-move tuning. Orbit and flip draw each card through its
exact homography, so cards keystone. Layers far from focus get depth-of-field blur.

## Camera

| name | params beyond the common ones |
|---|---|
| `static` | none |
| `pan` | `amount` deg (32), `from` / `to` deg, `dir` left / right |
| `tilt` | `amount` deg (34), `from` / `to` deg, `dir` up / down |
| `dolly in` | `amount` = share of the distance to the subject (0.55); `dir: out` |
| `zoom in` | `amount` = factor (1.8), about the subject; `dir: out` |
| `tracking shot` | `amount` world units (2.4); the subject travels with the camera |
| `orbit` | `amount` deg of arc (44), around the subject; cards keystone |
| `crane up` | `amount` rise (1.6), tilts down as it rises; `dir: down` |
| `dolly zoom` | `amount` travel (2.4); subject size held, the background swells (`dir: out`) or recedes (`in`) |
| `rack focus` | `from` / `to` layer or depth (fg to bg), `aperture` (70) |
| `handheld` | `amount` (1), `seed`; seeded noise, never random |
| `fpv` | `amount` forward travel (7), banking roll and swoop; with a `subject` it swerves around it, passing at `min` (1.6) |
| `dutch angle` | `amount` deg (15), `dir` left / right |

## Time effects

| name | params |
|---|---|
| `slow motion` | `rate` (0.25), `at` |
| `speed ramp` | `hi` (3), `lo` (0.15), `at`, `ramp`, `back` (s, or false) |
| `time-lapse` | `rate` (40) |
| `freeze frame` | `at` (s, default 45% in); white flash on the hold |

## Cuts

| name | what it does, params |
|---|---|
| `cut` | plain hard cut |
| `jump cut` | hard cut, same framing |
| `match cut` | `match: [outgoing anchor, incoming anchor]`; the next scene is reframed so the two shapes coincide |
| `whip pan` | `dir`, `dur` (0.24), `amount` px (1700); frames near it render with more subframes |
| `cross dissolve` | `dur` (0.5) |
| `wipe` | `dir`, `dur` (0.45) |
| `smash cut` | hard cut, flash, punch-in and shake; `cut_sfx` silences the music before the hit |
| `j-cut` / `l-cut` | picture: hard cut. Sound: `sfxlib.span()` leads or trails the scene's ambience by 0.5 s |
| `zoom through` | the default; `into` an anchor (with `r`, the hole radius) to fly through a shape into the next scene |
| `mask transition` | `from` anchor or `x` / `y`, `shape` circle / star / square, `rim` |
| `shape transition` | `colors`, `angle` (24) |
| `liquid transition` | `color`; a lit, thick sheet with drips, 1.0 s |
| `flip` | `backdrop`, `persp`; the frame turns about its vertical axis in real perspective |
| `glitch` | slices and RGB split, seeded per 1/24 s |

Frames near fast cuts ask for more motion-blur subframes on their own (`kAt`), so a whip pan smears instead of strobing.
