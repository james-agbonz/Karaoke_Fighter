#!/usr/bin/env python3
# Auto Song Pack Python Backend
# Called from Node.js server for YTMusic search and song generation

import sys
import json
import os
import subprocess
from pathlib import Path

try:
    from ytmusicapi import YTMusic
except ImportError:
    print(json.dumps({"error": "ytmusicapi not installed"}))
    sys.exit(1)

def search_songs(query: str, limit: int = 10, lyrics_only: bool = False):
    """Search YTMusic for songs"""
    yt = YTMusic()
    results = yt.search(query, filter='songs', limit=limit * 2)
    
    songs = []
    for r in results:
        if r.get('resultType') == 'song':
            video_id = r.get('videoId')
            # Check if search result has lyrics info (some versions include it)
            lyrics_obj = r.get('lyrics')
            lyrics_id = lyrics_obj.get('browseId') if lyrics_obj else None
            has_lyrics = bool(lyrics_id)
            
            # If lyrics_only filter is on and we don't have lyrics info from search,
            # we can't reliably filter without calling get_song (slow)
            # So we just pass the info we have
            if lyrics_only and not has_lyrics:
                # Could optionally call get_song here but it's slow
                pass
            
            songs.append({
                'videoId': video_id,
                'title': r.get('title'),
                'artist': r.get('artists', [{}])[0].get('name') if r.get('artists') else 'Unknown',
                'album': r.get('album', {}).get('name') if r.get('album') else None,
                'duration': r.get('duration'),
                'thumbnails': r.get('thumbnails', []),
                'lyricsId': lyrics_id,
                'hasLyrics': has_lyrics,
            })
            if len(songs) >= limit:
                break
    
    print(json.dumps(songs))
    return songs

def get_song_details(video_id: str):
    """Get detailed song info including lyrics"""
    yt = YTMusic()
    
    # Get song info
    song = yt.get_song(video_id)
    
    # Get lyrics if available
    lyrics = None
    if song.get('lyrics', {}).get('browseId'):
        try:
            lyrics_data = yt.get_lyrics(song['lyrics']['browseId'])
            lyrics = lyrics_data.get('lyrics')
        except:
            pass
    
    result = {
        'videoId': video_id,
        'title': song.get('videoDetails', {}).get('title'),
        'artist': song.get('videoDetails', {}).get('author'),
        'duration': song.get('videoDetails', {}).get('lengthSeconds'),
        'lyrics': lyrics,
        'thumbnails': song.get('videoDetails', {}).get('thumbnail', {}).get('thumbnails', []),
    }
    
    print(json.dumps(result))
    return result

def run_cmd(cmd: list, cwd: str = None):
    """Run command and return stdout"""
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        raise Exception(f"Command failed: {' '.join(cmd)}\n{result.stderr}")
    return result.stdout

def check_command_exists(cmd: str) -> bool:
    """Check if a command is available"""
    import shutil
    return shutil.which(cmd) is not None

def create_basic_song_pack(video_id: str, song_id: str, title: str):
    """Create a basic song.json with video info and lyrics only (no MIDI extraction)"""
    base_dir = Path(__file__).parent.parent
    songs_dir = base_dir / 'songs' / song_id
    songs_dir.mkdir(parents=True, exist_ok=True)
    
    print(f'🎵 Creating basic song pack: {title} → {song_id}')
    print(f'📁 Output: {songs_dir}\n')
    
    # Get duration via yt-dlp if available
    duration = 180
    if check_command_exists('yt-dlp'):
        try:
            result = subprocess.run([
                'yt-dlp', '--get-duration', f'https://youtube.com/watch?v={video_id}'
            ], capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                dur_str = result.stdout.strip()
                parts = dur_str.split(':')
                if len(parts) == 2:
                    duration = int(parts[0]) * 60 + int(parts[1])
                elif len(parts) == 3:
                    duration = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                print(f'  ✓ Duration: {duration}s')
        except:
            duration = 180
    else:
        duration = 180
        print('  ⚠ yt-dlp not available, using default duration')
    
    # Get lyrics from watch playlist (has lyrics browseId)
    yt = YTMusic()
    lyrics = []
    try:
        playlist = yt.get_watch_playlist(video_id)
        lyrics_browse_id = playlist.get('lyrics')
        if lyrics_browse_id:
            lyrics_data = yt.get_lyrics(lyrics_browse_id)
            if lyrics_data.get('lyrics'):
                raw_lyrics = lyrics_data['lyrics']
                print(f'  📝 Raw lyrics format: plain text (no timestamps)')
                # Lyrics are plain text without timestamps - split into lines
                # and assign approximate timestamps based on song duration
                lyric_lines = [line.strip() for line in raw_lyrics.split('\n') if line.strip()]
                if lyric_lines:
                    # Distribute lyrics evenly across song duration
                    # This is a rough approximation
                    lyrics = []
                    for i, line in enumerate(lyric_lines):
                        time = (duration * i) / len(lyric_lines) if len(lyric_lines) > 1 else 0
                        lyrics.append({'time': time, 'text': line})
                    print(f'  ✓ Parsed {len(lyrics)} lyric lines (estimated timestamps)')
    except Exception as e:
        print(f'  ⚠ Lyrics parsing error: {e}')
    if not lyrics:
        print('  ⚠ No synced lyrics available')
    if check_command_exists('yt-dlp'):
        try:
            result = subprocess.run([
                'yt-dlp', '--get-duration', f'https://youtube.com/watch?v={video_id}'
            ], capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                dur_str = result.stdout.strip()
                parts = dur_str.split(':')
                if len(parts) == 2:
                    duration = int(parts[0]) * 60 + int(parts[1])
                elif len(parts) == 3:
                    duration = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                print(f'  ✓ Duration: {duration}s')
        except:
            duration = 180
    else:
        duration = 180
        print('  ⚠ yt-dlp not available, using default duration')
    
    # Create basic song.json
    pack = {
        'id': song_id,
        'title': title,
        'youtubeId': video_id,
        'syncOffset': 0,
        'duration': duration,
        'sourceTrack': { 'index': -1, 'name': 'basic (no MIDI extraction)' },
        'notes': [],  # Empty - needs full generation
        'lyrics': lyrics,
        'noteCount': 0,
        'autoGenerated': True,
    }
    
    output_file = Path(__file__).parent.parent / 'songs' / song_id / 'song.json'
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump(pack, f, indent=1)
    
    print(f'\n✅ Created basic {output_file}')
    print(f'   Title: {title}')
    print(f'   Duration: {duration}s')
    print(f'   Lyrics: {len(lyrics)} lines')
    print(f'   Notes: 0 (run full generation for MIDI extraction)')
    print(f'\n💡 For full generation with MIDI, run:')
    print(f'   docker compose --profile tools run --rm auto-song "{title}" --id {song_id}')
    
    print(json.dumps({ 'success': True, 'songId': song_id, 'title': title, 'videoId': video_id, 'basic': True }))

def generate_song_pack(video_id: str, song_id: str, title: str):
    """Generate song pack with full pipeline: yt-dlp → demucs → basic-pitch → song.json"""
    
    # Check for optional dependencies
    has_demucs = check_command_exists('demucs')
    has_basic_pitch = check_command_exists('basic-pitch')
    has_yt_dlp = check_command_exists('yt-dlp')
    
    if not has_demucs or not has_basic_pitch or not has_yt_dlp:
        print('⚠️  Full generation requires demucs, basic-pitch, and yt-dlp')
        print('   Falling back to basic generation...\n')
        return create_basic_song_pack(video_id, song_id, title)
    
    print('🚀 Starting full generation pipeline...')
    
    base_dir = Path(__file__).parent.parent
    songs_dir = base_dir / 'songs' / song_id
    temp_dir = base_dir / '.temp' / song_id
    
    songs_dir.mkdir(parents=True, exist_ok=True)
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    print(f'🎵 Generating song pack: {title} → {song_id}')
    print(f'📁 Output: {songs_dir}')
    print(f'🗂️  Temp: {temp_dir}\n')
    
    try:
        # ─── 1. Download audio ───
        print('⬇️  Downloading audio...')
        audio_path = temp_dir / 'audio.mp3'
        run_cmd([
            'yt-dlp', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
            '-o', str(audio_path), f'https://youtube.com/watch?v={video_id}'
        ])
        
        # ─── 2. Get duration ───
        print('⏱️  Measuring duration...')
        result = subprocess.run([
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', str(audio_path)
        ], capture_output=True, text=True)
        duration = float(result.stdout.strip()) if result.returncode == 0 else 180
        print(f'  ✓ Duration: {duration}s')
        
        # ─── 3. Separate stems with Demucs ───
        print('🔬 Separating stems (Demucs)...')
        stems_dir = temp_dir / 'stems'
        run_cmd(['demucs', '--two-stems=vocals', '-o', str(stems_dir), str(audio_path)])
        
        vocal_path = stems_dir / 'htdemucs' / 'audio' / 'vocals.wav'
        inst_path = stems_dir / 'htdemucs' / 'audio' / 'no_vocals.wav'
        
        if not vocal_path.exists():
            raise Exception('Demucs failed to produce vocals.wav')
        
        # ─── 4. Extract MIDI from vocals with basic-pitch ───
        print('🎹 Extracting MIDI from vocals (basic-pitch)...')
        run_cmd(['basic-pitch', str(vocal_path), '--output-dir', str(temp_dir), '--output-midi'])
        
        generated_midi = temp_dir / 'audio_basic_pitch.mid'
        if not generated_midi.exists():
            raise Exception('basic-pitch failed to produce MIDI')
        
        # ─── 5. Parse MIDI and select melody track ───
        print('📊 Parsing MIDI...')
        tracks = parse_midi_file(generated_midi.read_bytes())
        analyzed = [analyze_track(t) for t in tracks]
        analyzed.sort(key=lambda t: t['score'], reverse=True)
        
        print('  Track analysis:')
        for t in analyzed:
            print(f"    {t['index']}: score={round(t['score'])} notes={len(t['notes'])} range={round(t['inRange']*100)}% poly={round(t['polyRatio']*100)}% {'★' if t['nameHit'] else ''}")
        
        chosen = analyzed[0]
        print(f'  ✓ Using track {chosen["index"]} as melody')
        
        melody = monophonize(chosen['notes'])
        melody_notes = []
        for n in melody:
            melody_notes.append({
                'time': round(n['time'] * 1000) / 1000,
                'duration': round(n['duration'] * 1000) / 1000,
                'midiNumber': n['midiNumber'],
                'pitch': round(midi_to_freq(n['midiNumber']) * 100) / 100,
                'velocity': n['velocity'],
            })
        
        # ─── 6. Get lyrics ───
        print('📝 Fetching lyrics...')
        yt = YTMusic()
        lyrics = []
        try:
            playlist = yt.get_watch_playlist(video_id)
            lyrics_browse_id = playlist.get('lyrics')
            if lyrics_browse_id:
                lyrics_data = yt.get_lyrics(lyrics_browse_id)
                if lyrics_data.get('lyrics'):
                    raw_lyrics = lyrics_data['lyrics']
                    print(f'  📝 Raw lyrics format: plain text (no timestamps)')
                    lyric_lines = [line.strip() for line in raw_lyrics.split('\n') if line.strip()]
                    if lyric_lines:
                        lyrics = []
                        for i, line in enumerate(lyric_lines):
                            time = (duration * i) / len(lyric_lines) if len(lyric_lines) > 1 else 0
                            lyrics.append({'time': time, 'text': line})
                        print(f'  ✓ Parsed {len(lyrics)} lyric lines (estimated timestamps)')
        except Exception as e:
            print(f'  ⚠ Lyrics parsing error: {e}')
        if not lyrics:
            print('  ⚠ No synced lyrics available')
        
        # ─── 7. Build song.json ───
        print('💾 Building song.json...')
        
        pack = {
            'id': song_id,
            'title': title,
            'youtubeId': video_id,
            'syncOffset': 0,
            'duration': round(duration * 100) / 100,
            'sourceTrack': { 'index': chosen['index'], 'name': 'auto-extracted vocal' },
            'notes': melody_notes,
            'lyrics': lyrics,
            'noteCount': len(melody_notes),
            'autoGenerated': True,
        }
        
        output_file = songs_dir / 'song.json'
        with open(output_file, 'w') as f:
            json.dump(pack, f, indent=1)
        
        print(f'\n✅ Created {output_file}')
        print(f'   {len(melody_notes)} melody notes, {len(lyrics)} lyric lines, {round(duration)}s')
        
        # Cleanup
        import shutil
        shutil.rmtree(temp_dir)
        
        print(json.dumps({ 'success': True, 'songId': song_id, 'title': title, 'videoId': video_id }))
        
    except Exception as e:
        print(f'\n❌ Full generation failed: {e}')
        print('   Falling back to basic generation...')
        return create_basic_song_pack(video_id, song_id, title)

def midi_to_freq(m: int) -> float:
    return 440 * (2 ** ((m - 69) / 12))

# ============ MIDI parsing (ported from add-song.mjs) ============
def read_chunk(d: bytes, p: int):
    typ = d[p:p+4].decode('ascii')
    length = int.from_bytes(d[p+4:p+8], 'big')
    return typ, length

def read_varlen(d: bytes, p: int):
    v = 0
    n = 0
    while True:
        b = d[p+n]
        v = (v << 7) | (b & 0x7F)
        n += 1
        if not (b & 0x80):
            break
    return v, n

def parse_midi_file(buffer: bytes):
    d = buffer
    pos = 0
    typ, _ = read_chunk(d, pos)
    if typ != 'MThd':
        raise ValueError('Not a MIDI file')
    pos += 8
    num_tracks = int.from_bytes(d[pos+2:pos+4], 'big')
    ticks_per_beat = int.from_bytes(d[pos+4:pos+6], 'big') & 0x7FFF
    pos += 6
    
    tempo_events = [{'tick': 0, 'usPerBeat': 500000}]
    tracks = []
    
    for t in range(num_tracks):
        typ, length = read_chunk(d, pos)
        if typ != 'MTrk':
            pos += 8 + length
            continue
        pos += 8
        end = pos + length
        tick = 0
        running = 0
        events = []
        name = ''
        channels = set()
        
        while pos < end:
            delta, bytes_read = read_varlen(d, pos)
            pos += bytes_read
            tick += delta
            
            et = d[pos]
            if et < 0x80:
                et = running
            else:
                pos += 1
                if et < 0xF0:
                    running = et
            
            msg = et & 0xF0
            ch = et & 0x0F
            
            if msg in (0x90, 0x80):
                note = d[pos]
                vel = d[pos+1]
                pos += 2
                channels.add(ch)
                events.append({
                    'tick': tick,
                    'type': 'on' if (msg == 0x90 and vel > 0) else 'off',
                    'note': note, 'vel': vel, 'ch': ch
                })
            elif msg in (0xA0, 0xB0, 0xE0):
                pos += 2
            elif msg in (0xC0, 0xD0):
                pos += 1
            elif et == 0xFF:
                meta = d[pos]
                pos += 1
                meta_len, len_bytes = read_varlen(d, pos)
                pos += len_bytes
                if meta == 0x51:
                    us_per_beat = int.from_bytes(d[pos:pos+3], 'big')
                    tempo_events.append({'tick': tick, 'usPerBeat': us_per_beat})
                if meta == 0x03 and not name:
                    name = d[pos:pos+meta_len].decode('utf-8', errors='ignore').strip()
                pos += meta_len
            elif et in (0xF0, 0xF7):
                sysex_len, len_bytes = read_varlen(d, pos)
                pos += len_bytes + sysex_len
        
        tracks.append({'index': len(tracks), 'name': name, 'channels': channels, 'events': events})
    
    # Build tempo map
    tempo_events.sort(key=lambda e: e['tick'])
    segs = []
    acc_sec = 0.0
    for i, cur in enumerate(tempo_events):
        if i > 0:
            prev = tempo_events[i-1]
            acc_sec += ((cur['tick'] - prev['tick']) / ticks_per_beat) * (prev['usPerBeat'] / 1e6)
        segs.append({'tick': cur['tick'], 'sec': acc_sec, 'usPerBeat': cur['usPerBeat']})
    
    def tick_to_sec(tick: int) -> float:
        s = segs[0]
        for seg in segs:
            if seg['tick'] <= tick:
                s = seg
            else:
                break
        return s['sec'] + ((tick - s['tick']) / ticks_per_beat) * (s['usPerBeat'] / 1e6)
    
    # Convert to notes in seconds
    for tr in tracks:
        active = {}
        tr['notes'] = []
        for e in tr['events']:
            key = f"{e['ch']}:{e['note']}"
            if e['type'] == 'on':
                active[key] = e
            else:
                if key in active:
                    on = active.pop(key)
                    t0 = tick_to_sec(on['tick'])
                    t1 = tick_to_sec(e['tick'])
                    tr['notes'].append({
                        'time': t0,
                        'duration': max(t1 - t0, 0.05),
                        'midiNumber': e['note'],
                        'velocity': on['vel'],
                        'channel': e['ch']
                    })
        tr['notes'].sort(key=lambda n: n['time'])
        del tr['events']
    
    return [t for t in tracks if t['notes']]

def analyze_track(tr):
    n = tr['notes']
    is_drums = all(c == 9 for c in tr['channels'])
    overlaps = 0
    for i in range(len(n) - 1):
        if n[i]['time'] + n[i]['duration'] > n[i+1]['time'] + 0.05:
            overlaps += 1
    poly_ratio = overlaps / (len(n) - 1) if len(n) > 1 else 0
    in_range = sum(1 for x in n if 48 <= x['midiNumber'] <= 84) / len(n) if n else 0
    pitches = sorted(x['midiNumber'] for x in n)
    median = pitches[len(pitches)//2] if pitches else 0
    span = (n[-1]['time'] + n[-1]['duration'] - n[0]['time']) if n else 0
    name_hit = any(kw in (tr['name'] or '').lower() for kw in ['vocal', 'voice', 'melod', 'lead', 'sing', 'karaoke'])
    
    score = 0
    if is_drums: score -= 10000
    if name_hit: score += 800
    score += in_range * 400
    score += (1 - poly_ratio) * 400
    score += min(len(n), 400)
    score += min(span, 200)
    if median < 45 or median > 90: score -= 300
    
    return {**tr, 'isDrums': is_drums, 'polyRatio': poly_ratio, 'inRange': in_range, 'median': median, 'span': span, 'nameHit': name_hit, 'score': score}

def monophonize(notes):
    out = []
    i = 0
    sorted_notes = sorted(notes, key=lambda n: (n['time'], -n['midiNumber']))
    while i < len(sorted_notes):
        j = i
        best = sorted_notes[i]
        while j + 1 < len(sorted_notes) and sorted_notes[j+1]['time'] - sorted_notes[i]['time'] < 0.03:
            j += 1
            if sorted_notes[j]['midiNumber'] > best['midiNumber']:
                best = sorted_notes[j]
        out.append({**best})
        i = j + 1
    for k in range(len(out) - 1):
        if out[k]['time'] + out[k]['duration'] > out[k+1]['time']:
            out[k]['duration'] = max(out[k+1]['time'] - out[k]['time'], 0.05)
    return out

def parse_lrc(text: str):
    """Parse LRC lyrics - handles multiple formats"""
    res = []
    import re
    
    # Standard LRC: [mm:ss.xx] text
    std_pattern = re.compile(r'\[(\d+):(\d+)(?:[.:](\d+))?\]\s*(.*)')
    
    # YouTube Music format: timestamp in seconds or different format
    # Some versions return: {"time": 12.5, "text": "lyrics"}
    # Or: {"lyrics": [{"time": 12.5, "text": "..."}, ...]}
    
    # First, check if it's already JSON/structured
    text = text.strip()
    if text.startswith('[') or text.startswith('{'):
        try:
            import json
            data = json.loads(text)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        time_val = item.get('time', item.get('startTime', item.get('timestamp')))
                        text_val = item.get('text', item.get('lyrics', item.get('content', '')))
                        if time_val is not None and text_val:
                            # Convert to seconds if in milliseconds
                            if isinstance(time_val, (int, float)) and time_val > 1000:
                                time_val = time_val / 1000
                            res.append({'time': float(time_val), 'text': str(text_val).strip()})
            elif isinstance(data, dict):
                if 'lyrics' in data and isinstance(data['lyrics'], list):
                    for item in data['lyrics']:
                        time_val = item.get('time', item.get('startTime', item.get('timestamp')))
                        text_val = item.get('text', item.get('lyrics', item.get('content', '')))
                        if time_val is not None and text_val:
                            if isinstance(time_val, (int, float)) and time_val > 1000:
                                time_val = time_val / 1000
                            res.append({'time': float(time_val), 'text': str(text_val).strip()})
                return sorted(res, key=lambda x: x['time'])
        except:
            pass  # Fall through to standard parsing
    
    # Standard LRC format
    pattern = re.compile(r'\[(\d+):(\d+)(?:[.:](\d+))?\]\s*(.*)')
    for line in text.split('\n'):
        m = pattern.match(line)
        if not m: continue
        t = int(m.group(1)) * 60 + int(m.group(2)) + (int(m.group(3).ljust(2, '0')[:2]) / 100 if m.group(3) else 0)
        txt = m.group(4).strip()
        if txt: res.append({'time': t, 'text': txt})
    
    return sorted(res, key=lambda x: x['time'])

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Action required: search, details, or generate"}))
        sys.exit(1)
    
    action = sys.argv[1]
    
    try:
        if action == 'search':
            query = sys.argv[2] if len(sys.argv) > 2 else ''
            limit = int(sys.argv[3]) if len(sys.argv) > 3 else 10
            search_songs(query, limit)
            
        elif action == 'details':
            video_id = sys.argv[2] if len(sys.argv) > 2 else ''
            get_song_details(video_id)
            
        elif action == 'generate':
            video_id = sys.argv[2] if len(sys.argv) > 2 else ''
            song_id = sys.argv[3] if len(sys.argv) > 3 else ''
            title = sys.argv[4] if len(sys.argv) > 4 else ''
            generate_song_pack(video_id, song_id, title)
            
        else:
            print(json.dumps({"error": f"Unknown action: {action}"}))
            sys.exit(1)
            
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)