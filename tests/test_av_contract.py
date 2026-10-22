"""A/V duration contract: build.py's MP4 has exactly NF = round(dur * fps) frames and NF / fps s of audio (NS samples at
48 kHz) whatever the lengths of music, voice and sfx.wav, and qc.py fails exactly when that breaks.
usage: python3 tests/test_av_contract.py [a b ...]      REEL_ROOT=<checkout> runs it against another tree
Each case is a temporary project of NF plain 64x112 PNGs and lavfi audio (sines; MP3 for case d), built with
tools/build.py <tmp> --from mix (--from sfx when it has an sfx.py), so no browser is involved; a few seconds per case.
(a)-(h) are the review matrix, (i)-(j) calibrate build.py's two guards, q1-q3 feed qc.py broken MP4s made directly by
ffmpeg. Needs ffmpeg/ffprobe and the repo's numpy + pillow. Exit 1 when any case fails."""
import os, sys, json, shutil, tempfile, subprocess, pathlib

ROOT = pathlib.Path(os.environ.get('REEL_ROOT') or pathlib.Path(__file__).resolve().parent.parent).resolve()
AAC = 1024 / 48000   # one AAC frame: the audio stream may differ from NF / fps by at most this
SFX = "import sfxlib as s\ns.put(0.5, s.pop()); s.cut_sfx('whip pan', 2.0); s.put(s.DUR - 0.3, s.ding()); s.duck(3.0, 4.0); s.save()\n"
# music / voice: seconds of sine (220 / 440 Hz); voice (a, b) = sounding for a s in a file b s long
CASES = {
    'a': ('music 10 + voice 8.08, no sfx', dict(music=10, voice=8.08)),
    'b': ('music 10 + voice 9.93', dict(music=10, voice=9.93)),
    'c': ('voice 8.08 only', dict(voice=8.08)),
    'd': ('music 30.772 (MP3) only', dict(music=30.772, mp3=True)),
    'e': ('silent: no music, voice or sfx.py', dict()),
    'f': ('voice sounding to 10.5 s: exact, guard FAILs', dict(music=10, voice=10.5, fail='voice still sounding')),
    'g': ('fps 24 dur 7.5: music 7.5 + voice 5 + sfx', dict(fps=24, dur=7.5, music=7.5, voice=5, sfx=True)),
    'h': ('dur 10.01 (NF 300): music 12 + sfx', dict(dur=10.01, music=12, sfx=True)),
    'i': ('music 8 only: padded, guard WARNs', dict(music=8, warn='music is')),
    'j': ('voice file 10.5 s, silent after 9.7: no FAIL', dict(music=10, voice=(9.7, 10.5))),
    'q1': ('qc: 297 frames + 9.93 s audio', dict(music=10, voice=9.93, mp4=(297, 9.93))),
    'q2': ('qc: audio project, no audio track', dict(music=10, mp4=(300, None))),
    'q3': ('qc: 300 frames + 9.9 s audio', dict(music=10, mp4=(300, 9.9))),
}
QC = ("import sys, json\nqc, ep = sys.argv[1:]; sys.argv = [qc, ep]; g = {'__name__': 'qc', '__file__': qc}\n"
      "exec(compile(open(qc).read(), qc, 'exec'), g); v = g['video_check']()\n"
      "print(json.dumps({'fail': g['fails'], 'warn': g['warns'], 'video': v}))")


def ff(*a): subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *map(str, a)], check=True)
def probe(f, sel, entry, *extra):
    return subprocess.run(['ffprobe', '-v', 'error', *extra, '-select_streams', sel, '-show_entries', f'stream={entry}',
                           '-of', 'csv=p=0', str(f)], capture_output=True, text=True).stdout.strip()
def samples(f): return int(probe(f, 'a:0', 'duration_ts')) if f.exists() else None


def run_case(key, tmp):
    desc, c = CASES[key]
    fps, dur = c.get('fps', 30), c.get('dur', 10); NF = round(dur * fps); T, NS = NF / fps, round(NF * 48000 / fps)
    ep = tmp / key; (ep / 'frames').mkdir(parents=True)
    cfg = {'name': 'av', 'w': 64, 'h': 112, 'fps': fps, 'dur': dur}
    ff('-f', 'lavfi', '-i', f'color=c=0x334455:s=64x112:r={fps}', '-frames:v', NF, '-start_number', 0, ep / 'frames/%04d.png')
    if c.get('music'):
        cfg['music'] = 'music.mp3' if c.get('mp3') else 'music.wav'
        ff('-f', 'lavfi', '-i', f'sine=f=220:sample_rate=48000:d={c["music"]}', *(['-c:a', 'libmp3lame'] if c.get('mp3') else []), ep / cfg['music'])
    if c.get('voice'):
        a, b = c['voice'] if isinstance(c['voice'], tuple) else (c['voice'], c['voice'])
        cfg['voice'] = 'voice.wav'; ff('-f', 'lavfi', '-i', f'sine=f=440:sample_rate=48000:d={a}', '-af', f'apad=whole_dur={b}', ep / 'voice.wav')
    if c.get('sfx'): (ep / 'sfx.py').write_text(SFX)
    (ep / 'project.json').write_text(json.dumps(cfg))
    want_audio = bool(c.get('music') or c.get('voice') or c.get('sfx'))
    mp4, bad, log, rc = ep / 'av.mp4', [], '', 0
    if c.get('mp4'):   # qc cases: a broken MP4 made directly, no build.py
        n, adur = c['mp4']; v = ep / 'video.mp4'   # n frames, then the audio muxed whole (-frames:v would cut it too)
        ff('-framerate', fps, '-i', ep / 'frames/%04d.png', '-frames:v', n, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v)
        if adur: ff('-i', v, '-f', 'lavfi', '-i', f'sine=f=220:sample_rate=48000:d={adur}', '-c:v', 'copy', '-c:a', 'aac', mp4)
        else: v.rename(mp4)
    else:
        r = subprocess.run([sys.executable, str(ROOT / 'tools/build.py'), str(ep), '--from', 'sfx' if c.get('sfx') else 'mix'],
                           capture_output=True, text=True)
        rc, log = r.returncode, r.stdout + r.stderr
        if c.get('fail'):
            if rc == 0 or 'FAIL' not in log or c['fail'] not in log: bad.append(f'build should FAIL with "{c["fail"]}" (rc {rc})')
        elif rc: bad.append(f'build rc {rc}: {log.strip().splitlines()[-1] if log.strip() else ""}')
        if c.get('warn') and not ('WARN' in log and c['warn'] in log): bad.append(f'build should WARN "{c["warn"]}"')
        if not c.get('warn') and 'WARN' in log: bad.append('unexpected WARN: ' + next(l for l in log.splitlines() if 'WARN' in l))
    nf = int(probe(mp4, 'v:0', 'nb_read_frames', '-count_frames') or 0) if mp4.exists() else 0
    aac = probe(mp4, 'a:0', 'duration') if mp4.exists() else ''
    ns, sx = samples(ep / 'mix.wav'), samples(ep / 'sfx.wav') if c.get('sfx') else None
    contract = [nf == NF, (aac != '' and abs(float(aac) - T) <= AAC) if want_audio else aac == '']
    if not c.get('mp4'): contract += [ns == NS] if want_audio else []
    if c.get('sfx'): contract.append(sx == NS)
    q = subprocess.run([sys.executable, '-c', QC, str(ROOT / 'tools/qc.py'), str(ep)], capture_output=True, text=True)
    try: q = json.loads(q.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError): q = {'fail': [f'qc.py crashed: {q.stderr.strip().splitlines()[-1:]}'], 'warn': []}
    if c.get('mp4'):   # broken on purpose: qc must fail
        if not q['fail']: bad.append('qc passed a broken MP4' + (f' (warn: {"; ".join(q["warn"])})' if q['warn'] else ''))
    else:   # qc must fail exactly when the contract is broken
        if not all(contract): bad.append('contract broken' + ('' if q['fail'] else ', qc missed it'))
        elif q['fail']: bad.append('qc failed a good MP4: ' + '; '.join(q['fail']))
        if not want_audio and any('audio' in w for w in q['warn']): bad.append('qc warns about audio in a silent project')
    row = dict(what=desc, frames=f'{nf}/{NF}', mix=f'{ns}/{NS}' if want_audio and not c.get('mp4') else '-',
               sfx=f'{sx}/{NS}' if c.get('sfx') else '-', aac=f'{float(aac):.3f}/{T:.3f}' if aac else ('none' if want_audio else 'none (ok)'),
               build='-' if c.get('mp4') else f'rc {rc}' + (' FAIL' if 'FAIL' in log else '') + (' WARN' if 'WARN' in log else ''),
               qc='FAIL' if q['fail'] else 'ok', result='FAIL' if bad else 'PASS', why='; '.join(bad))
    return row


def main(keys):
    keys = keys or list(CASES)
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='av-contract-'))
    try:
        print(f'reel-engine tree: {ROOT}')
        cols = [('case', 5), ('what', 47), ('frames', 9), ('mix', 15), ('sfx', 15), ('aac', 13), ('build', 14), ('qc', 5)]
        print(' '.join(f'{h:{w}}' for h, w in cols) + ' result')
        rows = []
        for k in keys:
            r = {**run_case(k, tmp), 'case': f'({k})'}; rows.append(r)
            print(' '.join(f'{r[h]:{w}}' for h, w in cols) + f' {r["result"]}' + (f'  <- {r["why"]}' if r['why'] else ''), flush=True)
        failed = [r['case'] for r in rows if r['result'] == 'FAIL']   # '(a)' ...
        print(f'{len(rows) - len(failed)}/{len(rows)} PASS' + (f', FAIL: {" ".join(failed)}' if failed else ''))
        return 1 if failed else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_av_contract():   # pytest entry point
    assert main([]) == 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
