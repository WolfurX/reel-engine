"""Render a project's frames: headless Chrome per worker, renderFrame(i, K) in the page, CDP screenshots to frames/NNNN.png.
usage: render.py <project_dir> [--K 6] [--workers 2] [--only i,j,k]
Size, fps and duration come from <project_dir>/project.json (w, h, fps, dur). Chrome: $CHROME, else a system Chrome or
Chromium, else Playwright's bundled Chromium (`playwright install chromium`)."""
import sys, os, json, base64, time, shutil, signal, subprocess

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
EP = os.path.abspath(args[0])
CFG = json.load(open(os.path.join(EP, 'project.json')))
VW, VH, FPS = int(CFG.get('w', 1080)), int(CFG.get('h', 1920)), int(CFG.get('fps', 30))
N = round(float(CFG.get('dur', 10)) * FPS)
K = int(opt('--K', 6)); WK = int(opt('--workers', 2)); ONLY = opt('--only', '')
OUT = os.path.join(EP, 'frames')
CANDIDATES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
              '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
CHROME = os.environ.get('CHROME') or next((c for c in CANDIDATES if os.path.exists(c)), None)


def worker(idxs, wid):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True, args=[
            '--force-device-scale-factor=1', '--hide-scrollbars', '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-breakpad', '--disable-crash-reporter'])
        pg = b.new_page(viewport={'width': VW, 'height': VH}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('file://' + os.path.join(EP, 'index.html')); pg.wait_for_timeout(300)
        if errs: raise SystemExit(f'page error on load: {errs[:2]}')
        cdp = pg.context.new_cdp_session(pg); t0 = time.time()
        for n, i in enumerate(idxs, 1):
            ms = pg.evaluate(f'renderFrame({i}, {K})')
            fn = os.path.join(OUT, f'{i:04d}.png')
            with open(fn + '.part', 'wb') as f:
                f.write(base64.b64decode(cdp.send('Page.captureScreenshot', {'format': 'png', 'optimizeForSpeed': True})['data']))
            os.replace(fn + '.part', fn)
            if errs: raise SystemExit(f'page error at frame {i}: {errs[:2]}')
            if n % 100 == 0: print(f'[w{wid}] {n}/{len(idxs)} {(time.time() - t0) / n:.2f}s/frame (draw {ms:.0f}ms)', flush=True)
        b.close()


if __name__ == '__main__':
    if '--worker' in sys.argv:   # child: render its own list
        worker([int(x) for x in ONLY.split(',')], int(opt('--worker', 0))); sys.exit(0)
    if ONLY:
        todo = [int(x) for x in ONLY.split(',')]; os.makedirs(OUT, exist_ok=True)
        for i in todo:
            try: os.remove(os.path.join(OUT, f'{i:04d}.png'))
            except FileNotFoundError: pass
    else:
        shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT); todo = list(range(N))
    t0 = time.time(); procs = []
    for k in range(WK):
        part = todo[k::WK]
        # children log to a file, never to our stdout: an orphaned Chrome crashpad helper that inherits the pipe keeps
        # the caller waiting long after the frames land
        if part: procs.append(subprocess.Popen(
            [sys.executable, __file__, EP, '--K', str(K), '--only', ','.join(map(str, part)), '--worker', str(k)],
            stdin=subprocess.DEVNULL, stdout=open(os.path.join(EP, f'render-w{k}.log'), 'w'), stderr=subprocess.STDOUT, start_new_session=True))
    # wait for the FRAMES, not the processes: the Playwright driver can keep a finished worker alive for minutes
    while True:
        got = sum(os.path.exists(os.path.join(OUT, f'{i:04d}.png')) for i in todo)
        if got == len(todo) or all(pr.poll() is not None for pr in procs): break
        time.sleep(1)
    time.sleep(1)
    for pr in procs:
        try: os.killpg(pr.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError): pass
    got = sum(os.path.exists(os.path.join(OUT, f'{i:04d}.png')) for i in todo)
    print(f'frames {got}/{len(todo)} in {time.time() - t0:.0f}s', flush=True)
    if got < len(todo):
        sys.exit(f'missing frames, see {EP}/render-w*.log')
