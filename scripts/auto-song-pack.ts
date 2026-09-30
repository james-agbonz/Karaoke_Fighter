#!/usr/bin/env node
// ============================================================
// Auto Song Pack Generator - Wrapper for Python implementation
// ============================================================
// Usage:
//   node scripts/auto-song-pack.ts "APT ROSÉ Bruno Mars" --id apt
// ============================================================

import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

interface Args {
  query: string;
  id: string;
  outputDir?: string;
  keepTemp?: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { query: '', id: '' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id') result.id = args[++i];
    else if (args[i] === '--output') result.outputDir = args[++i];
    else if (args[i] === '--keep-temp') result.keepTemp = true;
    else if (!result.query) result.query = args[i];
    else result.query += ' ' + args[i];
  }

  if (!result.query || !result.id) {
    console.error('Usage: node auto-song-pack.ts "search query" --id song-id [--output dir] [--keep-temp]');
    process.exit(1);
  }
  return result;
}

function run(cmd: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`  $ ${cmd}`);
    const proc = spawn(cmd, { shell: true, cwd, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', d => { stdout += d.toString(); });
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `Exit code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function main() {
  const { query, id, outputDir, keepTemp } = parseArgs();
  const outDir = outputDir || join(__dirname, '..', 'songs', id);
  const tempDir = join(__dirname, '..', '.temp', id);

  console.log(`\n🎵 Auto-generating song pack: "${query}" → ${id}`);
  console.log(`📁 Output: ${outDir}`);
  console.log(`🗂️  Temp: ${tempDir}\n`);

  try {
    // Call Python script which handles the full pipeline
    const pythonScript = join(__dirname, 'auto-song-pack.py');
    const cmd = `python3 "${pythonScript}" generate "${query}" "${id}"`;
    
    console.log('🔍 Searching YTMusic...');
    const searchCmd = `python3 "${pythonScript}" search "${query}" 1`;
    const searchResult = await run(searchCmd);
    const results = JSON.parse(searchResult);
    if (!results.length) throw new Error('No results found');
    const song = results[0];
    console.log(`  ✓ Found: ${song.title} by ${song.artist} (${song.videoId})`);

    console.log('📝 Fetching lyrics...');
    const lyricsResult = await run(`python3 "${pythonScript}" details "${song.videoId}"`);
    const details = JSON.parse(lyricsResult);
    console.log(`  ✓ Got lyrics: ${details.lyrics ? 'yes' : 'no'}`);

    console.log('⬇️  Downloading & processing (this takes a few minutes)...');
    const generateCmd = `python3 "${pythonScript}" generate "${song.videoId}" "${id}" "${song.title}"`;
    await run(generateCmd);

    console.log(`\n✅ Created ${outDir}/song.json`);
    console.log(`   Check the song pack in the Host UI → Song Packs dropdown`);

  } catch (err) {
    console.error('\n❌ Failed:', err);
    if (!keepTemp) {
      console.log('💡 Re-run with --keep-temp to inspect intermediate files');
    }
    console.log(JSON.stringify({ success: false, error: String(err) }));
    process.exit(1);
  }
}

main();