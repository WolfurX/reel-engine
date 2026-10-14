---
name: reel-engine
description: Make motion graphics and animated videos as code. Scenes are SVG drawn as a pure function of time, with depth layers, a real 3D camera (named moves like dolly in, orbit, whip pan), named cuts and element fx (typewriter, count-up, pop-in, particles...), rendered through WebGL motion blur and a film post pass, then mixed with music and synthesised SFX into an MP4. Use for explainers, title sequences, product and data animations, social clips, any motion piece.
---

# reel-engine

Motion graphics as code. You write scenes as SVG-returning functions of time; the engine handles the camera, the
transitions, the element animation, motion blur, post and the encode. Everything below is relative to this skill's folder.

## Workflow

1. **Plan before drawing.** Write down the piece as scenes: for each one, what the viewer should understand by its end,
   its time window, the camera move, the cut out of it, and the elements that animate. One idea per scene.
2. **Make a project folder** (copy `examples/demo/`): `project.json` holds size, fps, duration, planned cut times and the
   per-scene spec by name; `index.html` holds the drawing. Vocabulary: `docs/moves.md` (camera, time effects, cuts) and
   `docs/fx.md` (element fx). Scene API: `docs/scenes.md`.
3. **Preview:** `python3 tools/build.py <project> --preview`, then LOOK at `<project>/preview/contact.png`. Check every
   frame: text inside the safe box, nothing cropped by a camera move, every cut reads, the subject is where the camera
   expects it.
4. **Fix and preview again** until the contact sheet is right. Rendering the whole piece to discover a layout bug is slow.
5. **Build:** `python3 tools/build.py <project>` (steps `spec beats frames sfx mix`, resumable with `--from STEP`).
   Output: `<project>/<name>.mp4`.
6. **Watch the result** (or extract stills with ffmpeg) before calling it done.

Set `REEL_PY` to the Python that has Playwright if it is not the one running `build.py`.

## Rules that keep it working

- **Deterministic.** No `Math.random`, `Date`, or state between frames; seed any noise. The renderer draws subframes out
  of order across workers, so anything stateful breaks motion blur.
- **Names, not hand-tuned curves.** Use the named moves, cuts and fx; unknown names fail fast in `build.py`. Write custom
  motion only when no name fits.
- **Oversize backgrounds.** Layers are cards seen by a moving camera: draw skies and floors well past the frame edge.
- **Anchors for anything the camera or a cut refers to** (`subject`, `match`, `into`, `from`).
- **Shake only when something lands.** `impact shake` needs a `target`; decoration shake reads as noise.
- **Cut on the beat.** With `music` set, `tools/beats.py` measures the grid and snaps the planned `cuts`; read `BEATS` /
  `CUTS` from `beats.js` in the page to time hits.
- **Post settings:** keep `grain` at or below 0.03 (more balloons the file size); set `bloom: 0` on bright or paper-white
  scenes (the bloom threshold whitens them).
- **Colour:** `build.py` encodes BT.709 with explicit tags. Encode by hand only with the same flags, or colours shift on
  phones.
- **Short-form video:** the first frame is the thumbnail and the scroll-stopper. Have the subject and the main text on
  screen at t = 0 instead of fading in from black.

## Sound

- `music`: any audio file in the project (license it yourself). It ducks under `voice` and under `sfxlib.duck()` windows.
- `voice`: an optional narration file, mixed on top.
- `sfx.py`: synthesised effects from `tools/sfxlib.py` (no samples, nothing to license): `cut_sfx(name, t)` gives each
  named cut its canonical sound; `put(t, pop(...))`, `whoosh`, `ding`, `click`, `riser`, `boom`, `buzz` for hits.
- The mix is loudness-normalised to -14 LUFS.

## Requirements

Python 3.9+ with `numpy`, `pillow`, `playwright`; `ffmpeg` on PATH; Google Chrome or Chromium (or
`playwright install chromium`). WebGL2 must work in headless Chrome.
