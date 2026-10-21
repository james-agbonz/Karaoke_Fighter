#!/usr/bin/env node
// ============================================================
// Auto Song Pack — command-line wrapper around scripts/auto-song-pack.py
//
//   npm run song:auto -- "APT ROSÉ Bruno Mars"
//   npm run song:auto -- "Hey Jude Beatles" --id hey-jude-auto --keep-temp
//   npm run song:auto -- --check          (is everything installed?)
//
// Uses the same Python the server uses: $PYTHON_BIN, else ./.venv, else python3.
// Arguments are passed as a list (never through a shell), so any song title is safe.
// ============================================================

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

function pythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const candidates = process.platform === 'win32'
    ? ['.venv\\Scripts\\python.exe', 'venv\\Scripts\\python.exe']
    : ['.venv/bin/python', 'venv/bin/python'];
  for (const c of candidates) if (existsSync(join(root, c))) return join(root, c);
  return process.platform === 'win32' ? 'python' : 'python3';
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npm run song:auto -- "song name and artist" [--id song-id] [--keep-temp] [--force]');
  console.error('       npm run song:auto -- --check');
  process.exit(1);
}

const pyArgs = args[0] === '--check'
  ? ['check']
  : ['auto', ...args];

const proc = spawn(pythonBin(), [join(root, 'scripts', 'auto-song-pack.py'), ...pyArgs], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],   // progress/logs stream straight to the terminal
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
});

let out = '';
proc.stdout.on('data', d => { out += d.toString(); });
proc.on('error', err => {
  console.error(`Could not start Python (${pythonBin()}): ${err.message}`);
  console.error('Set up with: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt');
  process.exit(1);
});
proc.on('close', code => {
  const line = out.trim().split('\n').pop() || '';
  try {
    const result = JSON.parse(line);
    if (result.success) {
      console.log(`\n✅ songs/${result.songId}/song.json — ${result.noteCount} notes, ${result.lyricCount} lyric lines (${result.lyricsSource}), ${result.seconds}s`);
      console.log('   It now appears in the Host screen → Song Packs dropdown.');
    } else if ('ok' in result) {
      console.log(result.ok ? '✅ Everything is installed.' : `❌ Missing: ${result.missing.join(', ')}\n   ${result.hint}`);
    } else {
      console.error(`\n❌ ${result.error}${result.hint ? `\n💡 ${result.hint}` : ''}`);
    }
  } catch {
    if (line) console.log(line);
  }
  process.exit(code ?? 1);
});
