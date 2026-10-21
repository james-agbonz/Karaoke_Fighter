#!/usr/bin/env python3
"""
Auto Song Pack — turn a YouTube Music song into a playable songs/<id>/song.json

Pipeline:  yt-dlp (audio) -> demucs (isolate vocals) -> pYIN (vocal pitch -> notes)
           -> lyrics (YouTube Music timed > LRCLIB timed > plain lyrics aligned to the singing)

Commands (all print exactly ONE JSON object/array on stdout; logs go to stderr):
  check                                   which tools are installed
  search  "<query>" [limit]               search YouTube Music songs
  details <videoId>                       song info + lyrics availability
  generate <videoId> <songId> "<title>" ["<artist>"] [--keep-temp] [--force]
  auto    "<query>" [--id <songId>] [--keep-temp] [--force]   search + generate (CLI use)

Progress lines on stderr look like:  PROGRESS <0-100> <message>
The server shows those in the UI.

Install:  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   (+ ffmpeg)
"""
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SONGS_DIR = ROOT / 'songs'
TEMP_DIR = ROOT / '.temp'

MIN_NOTES = 20            # fewer than this = we didn't find a sung melody
USER_AGENT = 'KaraokeFighter/1.0 (https://github.com/james-agbonz/Karaoke_Fighter)'


# ───────────────────────────── output helpers ─────────────────────────────

def log(msg):
    print(msg, file=sys.stderr, flush=True)


def progress(pct, msg):
    print(f'PROGRESS {int(pct)} {msg}', file=sys.stderr, flush=True)


def emit(obj):
    """The single machine-readable result of a command."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


class PipelineError(Exception):
    def __init__(self, message, hint=None):
        super().__init__(message)
        self.hint = hint


# ───────────────────────────── tool check ─────────────────────────────

def _has_module(name):
    import importlib.util
    return importlib.util.find_spec(name) is not None


def check_tools():
    missing = []
    for mod, pip_name in [('ytmusicapi', 'ytmusicapi'), ('yt_dlp', 'yt-dlp'), ('demucs', 'demucs'),
                          ('librosa', 'librosa'), ('soundfile', 'soundfile'), ('numpy', 'numpy')]:
        if not _has_module(mod):
            missing.append(pip_name)
    if not shutil.which('ffmpeg'):
        missing.append('ffmpeg')
    return {
        'ok': not missing,
        'missing': missing,
        'python': sys.executable,
        'pythonVersion': sys.version.split()[0],
        'hint': None if not missing else (
            'Install with: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt'
            + ('  — and install ffmpeg (Mac: brew install ffmpeg)' if 'ffmpeg' in missing else '')),
    }


# ───────────────────────────── YouTube Music ─────────────────────────────

def _ytmusic():
    try:
        from ytmusicapi import YTMusic
    except ImportError:
        raise PipelineError('ytmusicapi is not installed', 'pip install -r requirements.txt')
    return YTMusic()


def _duration_to_seconds(text):
    if not text:
        return None
    try:
        parts = [int(p) for p in str(text).split(':')]
    except ValueError:
        return None
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return secs


def search_songs(query, limit=10):
    yt = _ytmusic()
    results = yt.search(query, filter='songs', limit=max(limit, 10))
    songs = []
    for r in results:
        if r.get('resultType') != 'song' or not r.get('videoId'):
            continue
        artists = r.get('artists') or []
        songs.append({
            'videoId': r['videoId'],
            'title': r.get('title') or 'Unknown',
            'artist': ', '.join(a.get('name', '') for a in artists if a.get('name')) or 'Unknown',
            'album': (r.get('album') or {}).get('name'),
            'duration': r.get('duration'),
            'durationSeconds': r.get('duration_seconds') or _duration_to_seconds(r.get('duration')),
            'thumbnails': r.get('thumbnails', []),
            'hasLyrics': None,   # unknown until details() — search results don't say
        })
        if len(songs) >= limit:
            break
    return songs


def _ytmusic_lyrics(video_id):
    """-> (timed_lines or None, plain_text or None)"""
    yt = _ytmusic()
    watch = yt.get_watch_playlist(videoId=video_id, limit=1)
    browse_id = watch.get('lyrics')
    if not browse_id:
        return None, None
    data = yt.get_lyrics(browse_id, timestamps=True)
    if not data or not data.get('lyrics'):
        return None, None
    if data.get('hasTimestamps'):
        lines = []
        for line in data['lyrics']:
            text = (getattr(line, 'text', None) or '').strip()
            start = getattr(line, 'start_time', None)
            if text and start is not None and text not in ('♪', '♫'):
                lines.append({'time': round(start / 1000.0, 3), 'text': text})
        return (lines or None), None
    return None, data['lyrics']


def get_song_details(video_id):
    yt = _ytmusic()
    song = yt.get_song(video_id)
    vd = song.get('videoDetails', {})
    timed, plain = None, None
    try:
        timed, plain = _ytmusic_lyrics(video_id)
    except Exception as e:  # lyrics are optional
        log(f'lyrics lookup failed: {e}')
    return {
        'videoId': video_id,
        'title': vd.get('title'),
        'artist': vd.get('author'),
        'duration': int(vd['lengthSeconds']) if vd.get('lengthSeconds') else None,
        'hasLyrics': bool(timed or plain),
        'hasTimedLyrics': bool(timed),
        'lyrics': plain if plain else ('\n'.join(l['text'] for l in timed) if timed else None),
        'thumbnails': vd.get('thumbnail', {}).get('thumbnails', []),
    }


# ───────────────────────────── LRCLIB (free lyrics database) ─────────────────────────────

def _clean_title(title):
    t = re.sub(r'\s*[\(\[](feat\.?|ft\.?|with|prod\.?)[^\)\]]*[\)\]]', '', title, flags=re.I)
    t = re.sub(r'\s*-\s*(remaster(ed)?|radio edit|single version|official).*$', '', t, flags=re.I)
    return t.strip()


def _parse_lrc(text):
    out = []
    for raw in text.splitlines():
        stamps = re.findall(r'\[(\d+):(\d+(?:\.\d+)?)\]', raw)
        lyric = re.sub(r'\[[^\]]*\]', '', raw).strip()
        if not stamps or not lyric:
            continue
        for mm, ss in stamps:
            out.append({'time': round(int(mm) * 60 + float(ss), 3), 'text': lyric})
    return sorted(out, key=lambda x: x['time'])


def lrclib_lyrics(title, artist, duration):
    """-> (timed_lines or None, plain_text or None). Never raises."""
    try:
        params = urllib.parse.urlencode({'track_name': _clean_title(title), 'artist_name': artist.split(',')[0].strip()})
        req = urllib.request.Request(f'https://lrclib.net/api/search?{params}', headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=12) as r:
            results = json.loads(r.read().decode('utf8'))
    except Exception as e:
        log(f'  LRCLIB lookup failed: {e}')
        return None, None
    # prefer: has synced lyrics, duration within 3 s of our audio
    best = None
    for item in results or []:
        if item.get('instrumental'):
            continue
        d = item.get('duration') or 0
        close = abs(d - duration) <= 3 if duration else True
        score = (2 if item.get('syncedLyrics') else 0) + (1 if close else 0)
        if close or not duration:
            if best is None or score > best[0]:
                best = (score, item)
    if not best:
        return None, None
    item = best[1]
    timed = _parse_lrc(item['syncedLyrics']) if item.get('syncedLyrics') else None
    return (timed or None), item.get('plainLyrics')


# ───────────────────────────── vocals -> notes (pYIN) ─────────────────────────────
# Tested against a synthetic singer with known notes (100% of notes found, onsets ~5 ms)
# and against basic-pitch on real a cappella (~80% agreement). pYIN replaces basic-pitch,
# which cannot be installed on Python 3.12+ (it pins TensorFlow 2.15).

SR = 16000
HOP = 160                 # 10 ms frames
FRAME = 1024
FMIN, FMAX = 65.4, 1046.5  # C2..C6 singing range
SPLIT_SEMITONES = 0.75     # pitch must move this far...
SPLIT_FRAMES = 5           # ...for 50 ms to start a new note (vibrato doesn't split)
GAP_FRAMES = 4             # 40 ms of silence ends a note
MIN_NOTE_S = 0.08
MERGE_GAP_S = 0.06
VOICED_PROB_MIN = 0.15
DIP_DB = 6.0               # syllable break on the same pitch = volume dip this deep...
DIP_WINDOW_S = 0.12        # ...relative to the loudest point this close on each side


def _track_pitch(y):
    import numpy as np
    import librosa
    f0, voiced_flag, voiced_prob = librosa.pyin(y, fmin=FMIN, fmax=FMAX, sr=SR, frame_length=FRAME, hop_length=HOP)
    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP)[0]
    n = min(len(f0), len(rms))
    f0, voiced_flag, voiced_prob, rms = f0[:n], voiced_flag[:n], voiced_prob[:n], rms[:n]
    db = 20 * np.log10(rms + 1e-9)
    gate = db > np.percentile(db, 95) - 30          # ignore faint instrument bleed
    voiced = voiced_flag & gate & (voiced_prob > VOICED_PROB_MIN) & ~np.isnan(f0)
    midi = np.full(n, np.nan)
    midi[voiced] = 69 + 12 * np.log2(f0[voiced] / 440.0)
    rms_short = librosa.feature.rms(y=y, frame_length=400, hop_length=HOP)[0][:n]
    rms_short = np.pad(rms_short, (0, n - len(rms_short)), constant_values=1e-9)
    db_short = 20 * np.log10(rms_short + 1e-9)
    return np.arange(n) * HOP / SR, midi, voiced, db_short


def _median_smooth(values, k=5):
    import numpy as np
    out = values.copy()
    half = k // 2
    for i in range(len(values)):
        if np.isnan(values[i]):
            continue
        w = values[max(0, i - half): i + half + 1]
        out[i] = np.median(w[~np.isnan(w)])
    return out


def _segment_notes(times, midi, voiced):
    import numpy as np
    m = _median_smooth(midi, 5)
    dt = HOP / SR
    notes, cur, pending, gap = [], None, [], 0

    def close(end_idx):
        nonlocal cur
        if cur and cur['frames']:
            notes.append({'start': times[cur['start']], 'end': times[end_idx] + dt,
                          'midi_float': float(np.median(cur['frames']))})
        cur = None

    for i in range(len(m)):
        if not voiced[i] or np.isnan(m[i]):
            gap += 1
            if cur and gap >= GAP_FRAMES:
                close(i - gap)
                pending = []
            continue
        gap = 0
        if cur is None:
            cur, pending = {'start': i, 'frames': [m[i]]}, []
            continue
        center = np.median(cur['frames'][-30:])
        if abs(m[i] - center) > SPLIT_SEMITONES:
            pending.append((i, m[i]))
            if len(pending) >= SPLIT_FRAMES:
                first = pending[0][0]
                close(first - 1)
                cur, pending = {'start': first, 'frames': [p[1] for p in pending]}, []
        else:
            if pending:
                cur['frames'].extend(p[1] for p in pending)
                pending = []
            cur['frames'].append(m[i])
    if cur:
        close(len(m) - 1)

    merged = []
    for n in notes:
        n['midi'] = int(round(n['midi_float']))
        if merged and n['midi'] == merged[-1]['midi'] and n['start'] - merged[-1]['end'] < MERGE_GAP_S:
            merged[-1]['end'] = n['end']
        else:
            merged.append(dict(n))
    return [n for n in merged if n['end'] - n['start'] >= MIN_NOTE_S]


def _split_on_volume_dips(notes, db):
    dt = HOP / SR
    w = int(DIP_WINDOW_S / dt)
    out = []
    for n in notes:
        i0, i1 = int(n['start'] / dt), int(n['end'] / dt)
        cuts, i = [], i0 + w
        while i < i1 - w:
            if db[i] == db[i - 1:i + 2].min():
                if db[i - w:i].max() - db[i] >= DIP_DB and db[i + 1:i + w + 1].max() - db[i] >= DIP_DB:
                    cuts.append(i)
                    i += w
                    continue
            i += 1
        bounds = [i0] + cuts + [i1]
        for a, b in zip(bounds, bounds[1:]):
            if (b - a) * dt >= MIN_NOTE_S:
                out.append({**n, 'start': a * dt, 'end': b * dt})
    return out


def extract_vocal_notes(vocals_path):
    import librosa
    y, _ = librosa.load(str(vocals_path), sr=SR, mono=True)
    times, midi, voiced, db = _track_pitch(y)
    return _split_on_volume_dips(_segment_notes(times, midi, voiced), db)


# ───────────────────────────── lyric timing ─────────────────────────────
# Tested on synthetic singers that follow real lyric timestamps:
#  - timed lyrics shifted by -1.3..+6 s are corrected exactly
#  - plain lyrics: 84% of lines within 1 s (old even spacing: 28%)

PHRASE_GAP_S = 0.25
ALIGN_MIN_GAP = 0.45       # 0.3 mistakes breaths for line breaks
PAUSE_BONUS = 8.0


def _phrase_onsets(notes, min_gap=PHRASE_GAP_S):
    out, prev_end = [], -10.0
    for n in notes:
        gap = n['start'] - prev_end
        if gap >= min_gap:
            out.append((n['start'], gap))
        prev_end = max(prev_end, n['end'])
    return out


def estimate_offset(line_times, notes, max_shift, step=0.05, sigma=0.2):
    import numpy as np
    on = np.array([t for t, _ in _phrase_onsets(notes)])
    lt = np.array(line_times)
    if len(on) < 3 or len(lt) < 3:
        return 0.0, 0.0
    shifts = np.arange(-max_shift, max_shift + step / 2, step)
    scores = np.empty(len(shifts))
    for k, s in enumerate(shifts):
        d = np.min(np.abs(on[None, :] - (lt[:, None] + s)), axis=1)
        scores[k] = np.mean(np.exp(-(d ** 2) / (2 * sigma ** 2)))
    k = int(np.argmax(scores))
    zero = int(np.argmin(np.abs(shifts)))
    confidence = float(np.clip((scores[k] - np.median(scores)) / max(scores[k], 1e-9), 0, 1))
    if scores[k] - scores[zero] < 0.05:
        return 0.0, confidence
    return float(round(shifts[k], 2)), confidence


def _syllable_weight(text):
    t = text.lower()
    latin = re.findall(r'[a-z]+', t)
    w = sum(max(1, len(re.findall(r'[aeiouy]+', word))) for word in latin)
    other = len(re.findall(r'[^\sa-z0-9\W]', t))
    return max(1, w + other)


def align_plain_lines(lines, notes, song_duration):
    import numpy as np
    n = len(lines)
    if n == 0:
        return []
    onsets = _phrase_onsets(notes, min_gap=ALIGN_MIN_GAP)
    if len(onsets) < n:
        onsets = _phrase_onsets(notes, min_gap=0.08)
    if len(onsets) < n or not notes:
        s0 = notes[0]['start'] if notes else 0.0
        s1 = notes[-1]['end'] if notes else song_duration
        return [s0 + (s1 - s0) * i / n for i in range(n)]
    times = np.array([t for t, _ in onsets])
    gaps = np.array([g for _, g in onsets])
    m = len(times)
    starts = np.array([x['start'] for x in notes])
    cum = np.array([float(np.sum(starts < t - 1e-6)) for t in times] + [float(len(starts))])
    w = np.array([_syllable_weight(l) for l in lines], dtype=float)
    k = cum[-1] / w.sum()
    bonus = PAUSE_BONUS * np.log1p(np.minimum(gaps, 3.0)) * max(k, 0.5)
    INF = 1e18
    dp = np.full((n, m), INF)
    back = np.zeros((n, m), dtype=int)
    dp[0, :] = 0.0
    dp[0, 1:] = (cum[1:m] - cum[0]) * 0.5
    dp[0] -= bonus
    idx = np.arange(m)
    forward_only = idx[:, None] >= idx[None, :]
    span = cum[None, :m] - cum[:m, None]
    for i in range(1, n):
        exp_len = w[i - 1] * k
        cost = (span - exp_len) ** 2 / max(exp_len, 1e-3)
        cost[forward_only] = INF
        total = dp[i - 1][:, None] + cost
        back[i] = np.argmin(total, axis=0)
        dp[i] = total[back[i], idx] - bonus
    last_len = w[-1] * k
    final = dp[n - 1] + (cum[-1] - cum[:m] - last_len) ** 2 / max(last_len, 1e-3)
    j = int(np.argmin(final))
    path = [j]
    for i in range(n - 1, 0, -1):
        j = int(back[i, j])
        path.append(j)
    path.reverse()
    return [float(times[j]) for j in path]


def build_lyrics(video_id, title, artist, duration, notes):
    """Best available lyrics, timed against the actual singing. -> (lines, source, offset)"""
    plain = None
    try:
        timed, plain = _ytmusic_lyrics(video_id)
    except Exception as e:
        log(f'  YouTube Music lyrics failed: {e}')
        timed = None
    if timed:
        off, conf = estimate_offset([l['time'] for l in timed], notes, max_shift=2.0)
        log(f'  YouTube Music timed lyrics: {len(timed)} lines (offset check {off:+.2f}s, confidence {conf:.2f})')
        return [{'time': round(l['time'] + off, 3), 'text': l['text']} for l in timed], 'ytmusic-timed', off

    lr_timed, lr_plain = lrclib_lyrics(title, artist, duration)
    if lr_timed:
        off, conf = estimate_offset([l['time'] for l in lr_timed], notes, max_shift=8.0)
        log(f'  LRCLIB timed lyrics: {len(lr_timed)} lines (shifted {off:+.2f}s, confidence {conf:.2f})')
        return [{'time': round(l['time'] + off, 3), 'text': l['text']} for l in lr_timed], 'lrclib-timed', off

    plain = plain or lr_plain
    if plain:
        lines = [l.strip() for l in plain.splitlines() if l.strip() and not re.match(r'^\[.*\]$', l.strip())]
        times = align_plain_lines(lines, notes, duration)
        log(f'  Plain lyrics: {len(lines)} lines placed on the singing')
        return [{'time': round(t, 3), 'text': l} for t, l in zip(times, lines)], 'aligned-to-vocals', 0.0

    log('  No lyrics found')
    return [], 'none', 0.0


# ───────────────────────────── generation ─────────────────────────────

def _run(cmd, step_name, hint=None, timeout=None):
    log(f'  $ {" ".join(str(c) for c in cmd[:6])}{" …" if len(cmd) > 6 else ""}')
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        tail = '\n'.join((r.stderr or r.stdout or '').strip().splitlines()[-6:])
        raise PipelineError(f'{step_name} failed: {tail or "exit code " + str(r.returncode)}', hint)
    return r.stdout


def _existing_pack(song_id):
    f = SONGS_DIR / song_id / 'song.json'
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text('utf8'))
    except Exception:
        return {}


def generate_song_pack(video_id, song_id, title, artist='', keep_temp=False, force=False):
    if not re.fullmatch(r'[A-Za-z0-9_-]{6,20}', video_id or ''):
        raise PipelineError(f'Invalid YouTube video id: {video_id!r}')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,60}', song_id or ''):
        raise PipelineError(f'Invalid song id: {song_id!r} (lowercase letters, digits and dashes)')

    existing = _existing_pack(song_id)
    if existing is not None and not existing.get('autoGenerated') and not force:
        raise PipelineError(f'songs/{song_id} is a hand-made pack; refusing to overwrite it',
                            'Pick a different id, or pass --force')

    tools = check_tools()
    if not tools['ok']:
        raise PipelineError('Missing tools: ' + ', '.join(tools['missing']), tools['hint'])

    work = TEMP_DIR / song_id
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    started = time.time()
    try:
        # 1. download audio (same video the game will play, so timing lines up)
        progress(5, 'Downloading audio…')
        _run([sys.executable, '-m', 'yt_dlp', '--no-playlist', '-f', 'bestaudio/best', '-x',
              '--audio-format', 'wav', '-o', str(work / 'audio.%(ext)s'),
              f'https://www.youtube.com/watch?v={video_id}'],
             'Download', 'YouTube changes often — update with: pip install -U yt-dlp', timeout=600)
        audio = work / 'audio.wav'
        if not audio.exists():
            found = list(work.glob('audio.*'))
            raise PipelineError(f'Download produced no wav file ({[f.name for f in found]})', 'Is ffmpeg installed?')
        import soundfile as sf
        duration = float(sf.info(str(audio)).duration)
        log(f'  audio: {duration:.1f}s')

        # 2. isolate the vocals
        progress(20, 'Separating vocals from the music (1–4 min)…')
        _run([sys.executable, '-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs',
              '-o', str(work / 'stems'), str(audio)],
             'Vocal separation (demucs)', 'First run downloads an ~80 MB model; check your internet connection',
             timeout=3600)
        vocals = next((work / 'stems').rglob('vocals.wav'), None)
        if not vocals:
            raise PipelineError('Vocal separation produced no vocals.wav')

        # 3. vocals -> melody notes
        progress(65, 'Finding the sung melody…')
        notes = extract_vocal_notes(vocals)
        log(f'  {len(notes)} melody notes')
        if len(notes) < MIN_NOTES:
            raise PipelineError(f'Only found {len(notes)} sung notes — not enough to play',
                                'This may be an instrumental, or the vocals are very quiet. Try another version of the song.')

        # 4. lyrics
        progress(85, 'Fetching and timing lyrics…')
        lyrics, lyrics_source, lyrics_offset = build_lyrics(video_id, title, artist, duration, notes)

        # 5. write the pack (atomically, so a crash never leaves half a file)
        progress(95, 'Saving song pack…')
        melody = [{
            'time': round(n['start'], 3),
            'duration': round(n['end'] - n['start'], 3),
            'midiNumber': n['midi'],
            'pitch': round(440 * 2 ** ((n['midi'] - 69) / 12), 2),
            'velocity': 100,
        } for n in notes]
        pack = {
            'id': song_id,
            'title': f'{title} — {artist}' if artist and artist.lower() not in title.lower() else title,
            'youtubeId': video_id,
            'syncOffset': 0,
            'duration': round(duration, 2),
            'sourceTrack': {'index': -1, 'name': 'auto: demucs vocals + pYIN'},
            'notes': melody,
            'lyrics': lyrics,
            'lyricsSource': lyrics_source,
            'lyricsOffsetApplied': lyrics_offset,
            'autoGenerated': True,
            'generatedAt': int(time.time()),
        }
        out_dir = SONGS_DIR / song_id
        out_dir.mkdir(parents=True, exist_ok=True)
        tmp = out_dir / 'song.json.tmp'
        tmp.write_text(json.dumps(pack, ensure_ascii=False, indent=1), 'utf8')
        tmp.replace(out_dir / 'song.json')
        progress(100, 'Done')
        return {
            'success': True, 'songId': song_id, 'title': pack['title'], 'videoId': video_id,
            'noteCount': len(melody), 'lyricCount': len(lyrics), 'lyricsSource': lyrics_source,
            'seconds': round(time.time() - started),
        }
    finally:
        if not keep_temp and work.exists():
            shutil.rmtree(work, ignore_errors=True)


def slugify(text):
    s = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return s[:48].strip('-') or 'song'


# ───────────────────────────── CLI ─────────────────────────────

def main(argv):
    if len(argv) < 2:
        emit({'success': False, 'error': 'Usage: auto-song-pack.py check|search|details|generate|auto …'})
        return 2
    action, rest = argv[1], argv[2:]
    flags = {a for a in rest if a.startswith('--') and a not in ('--id',)}
    pos = []
    i = 0
    opt_id = None
    while i < len(rest):
        if rest[i] == '--id' and i + 1 < len(rest):
            opt_id = rest[i + 1]
            i += 2
            continue
        if not rest[i].startswith('--'):
            pos.append(rest[i])
        i += 1
    try:
        if action == 'check':
            emit(check_tools())
        elif action == 'search':
            emit(search_songs(pos[0] if pos else '', int(pos[1]) if len(pos) > 1 else 10))
        elif action == 'details':
            emit(get_song_details(pos[0]))
        elif action == 'generate':
            video_id, song_id, title = pos[0], pos[1], pos[2] if len(pos) > 2 else pos[1]
            artist = pos[3] if len(pos) > 3 else ''
            emit(generate_song_pack(video_id, song_id, title, artist,
                                    keep_temp='--keep-temp' in flags, force='--force' in flags))
        elif action == 'auto':
            query = ' '.join(pos)
            progress(1, f'Searching YouTube Music for "{query}"…')
            results = search_songs(query, 1)
            if not results:
                raise PipelineError(f'No songs found for "{query}"')
            s = results[0]
            log(f'  found: {s["title"]} — {s["artist"]} ({s["videoId"]})')
            emit(generate_song_pack(s['videoId'], opt_id or slugify(f'{s["title"]}-{s["artist"]}'), s['title'],
                                    s['artist'], keep_temp='--keep-temp' in flags, force='--force' in flags))
        else:
            raise PipelineError(f'Unknown action: {action}')
        return 0
    except PipelineError as e:
        log(f'ERROR: {e}')
        emit({'success': False, 'error': str(e), 'hint': e.hint})
        return 1
    except Exception as e:  # unexpected: still answer in JSON so the server can show it
        log(f'ERROR: {type(e).__name__}: {e}')
        name = type(e).__name__
        if any(k in name for k in ('ConnectionError', 'ProxyError', 'Timeout', 'URLError')):
            emit({'success': False, 'error': "Couldn't reach YouTube Music.",
                  'hint': 'Check your internet connection and try again.'})
        else:
            emit({'success': False, 'error': f'{name}: {e}'})
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
