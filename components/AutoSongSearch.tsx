import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Music, Search, Loader2, CheckCircle, AlertCircle, Download, Play, Wrench } from 'lucide-react';

interface SongSearchResult {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  duration?: string;
  durationSeconds?: number;
  thumbnails?: Array<{ url: string }>;
  hasLyrics?: boolean | null;
}

interface SongDetails {
  videoId: string;
  title: string;
  artist: string;
  duration?: number;
  hasLyrics?: boolean;
  hasTimedLyrics?: boolean;
  thumbnails?: Array<{ url: string }>;
}

interface GenerationJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: string;
  percent?: number;
  queuePosition?: number;
  result?: { songId: string; title: string; videoId: string; noteCount: number; lyricCount: number; lyricsSource: string };
  error?: string;
  hint?: string;
}

interface ToolStatus { ok: boolean; missing: string[]; hint?: string | null; pythonVersion?: string }

interface AutoSongSearchProps {
  onSongReady: (songId: string, songData: any) => void;
  isLoading?: boolean;
}

const LYRICS_LABEL: Record<string, string> = {
  'ytmusic-timed': 'official timed lyrics',
  'lrclib-timed': 'timed lyrics (LRCLIB), synced to the vocals',
  'aligned-to-vocals': 'lyrics timed from the singing',
  none: 'no lyrics found',
};

export const AutoSongSearch: React.FC<AutoSongSearchProps> = ({ onSongReady }) => {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SongSearchResult[]>([]);
  const [selectedSong, setSelectedSong] = useState<SongSearchResult | null>(null);
  const [songDetails, setSongDetails] = useState<SongDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [generationJob, setGenerationJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [step, setStep] = useState<'search' | 'confirm' | 'generating' | 'complete'>('search');
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSongReadyRef = useRef(onSongReady);
  onSongReadyRef.current = onSongReady;

  const apiBase = '/api';

  // Is the Python side set up? Checked once so we can explain instead of failing later.
  useEffect(() => {
    fetch(`${apiBase}/songs/tools`).then(r => r.json()).then(setTools)
      .catch(() => setTools({ ok: false, missing: ['server'], hint: 'Is the game server running?' }));
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, []);

  const searchSongs = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/songs/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      const data = await res.json();
      if (res.ok) {
        setSearchResults(data);
        if (data.length === 0) setError({ message: 'No songs found. Try the artist name too.' });
      } else {
        setError({ message: data.error || 'Search failed', hint: data.hint });
      }
    } catch {
      setError({ message: 'Failed to search. Is the server running?' });
    } finally {
      setSearching(false);
    }
  }, []);

  const selectSong = useCallback(async (song: SongSearchResult) => {
    setSelectedSong(song);
    setSongDetails(null);
    setError(null);
    setStep('confirm');
    setDetailsLoading(true);
    try {
      const res = await fetch(`${apiBase}/songs/details/${song.videoId}`);
      if (res.ok) setSongDetails(await res.json());
    } catch (err) {
      console.warn('Could not fetch song details:', err);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const pollGenerationStatus = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`${apiBase}/songs/generate/${jobId}/status`);
      const job: GenerationJob = await res.json();
      if (!res.ok) throw new Error((job as any).error || 'Job not found');
      setGenerationJob(job);
      if (job.status === 'completed' && job.result) {
        setStep('complete');
        const packRes = await fetch(`${apiBase}/songs/${job.result.songId}/pack`);
        if (packRes.ok) onSongReadyRef.current(job.result.songId, await packRes.json());
      } else if (job.status === 'failed') {
        setError({ message: job.error || 'Generation failed', hint: job.hint });
        setStep('confirm');
      } else {
        pollTimer.current = setTimeout(() => pollGenerationStatus(jobId), 2000);
      }
    } catch (err) {
      console.error('Polling error:', err);
      pollTimer.current = setTimeout(() => pollGenerationStatus(jobId), 5000);
    }
  }, []);

  const startGeneration = useCallback(async () => {
    if (!selectedSong) return;
    setStep('generating');
    setError(null);
    setGenerationJob(null);
    try {
      // Send the exact song the user picked (not the search text).
      const res = await fetch(`${apiBase}/songs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: selectedSong.videoId, title: selectedSong.title, artist: selectedSong.artist }),
      });
      const data = await res.json();
      if (res.ok && data.jobId) {
        pollGenerationStatus(data.jobId);
      } else {
        setError({ message: data.error || 'Failed to start generation', hint: data.hint });
        setStep('confirm');
      }
    } catch {
      setError({ message: 'Failed to start generation. Is the server running?' });
      setStep('confirm');
    }
  }, [selectedSong, pollGenerationStatus]);

  const reset = () => {
    setQuery('');
    setSearchResults([]);
    setSelectedSong(null);
    setSongDetails(null);
    setGenerationJob(null);
    setError(null);
    setStep('search');
  };

  const formatDuration = (value?: string | number) => {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'string' && value.includes(':')) return value;
    const secs = typeof value === 'string' ? parseInt(value) : value;
    if (!Number.isFinite(secs)) return '';
    return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
  };

  const setupNeeded = tools && !tools.ok;
  const percent = generationJob?.status === 'completed' ? 100 : Math.max(generationJob?.percent ?? 0, 3);

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 md:p-6 border border-cyan-700/50">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Music className="w-5 h-5 text-cyan-400" />
        <h3 className="text-lg font-bold text-cyan-300">Auto Song Generator</h3>
        <span className="text-xs bg-cyan-900/50 text-cyan-300 px-2 py-0.5 rounded">YouTube Music + Demucs + pYIN</span>
      </div>

      {setupNeeded && (
        <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-600 rounded-lg text-yellow-100 text-sm">
          <div className="flex items-center gap-2 font-bold mb-1"><Wrench className="w-4 h-4" /> One-time setup needed</div>
          <p>Missing: {tools!.missing.join(', ')}</p>
          {tools!.hint && <p className="mt-1 font-mono text-xs break-all">{tools!.hint}</p>}
          <p className="mt-1 text-xs text-yellow-300/80">Then restart the server. You can still search, but generating needs these tools.</p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-600 rounded-lg flex items-start gap-2 text-red-200">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm min-w-0">
            <p className="whitespace-pre-wrap break-words">{error.message}</p>
            {error.hint && <p className="mt-1 text-red-300/80">💡 {error.hint}</p>}
          </div>
        </div>
      )}

      {/* Step 1: Search */}
      {step === 'search' && (
        <div className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); searchSongs(query); }} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Song and artist (e.g. 'APT ROSÉ Bruno Mars')"
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white placeholder-gray-500"
              disabled={searching}
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 px-4 py-2 rounded font-bold flex items-center gap-2"
            >
              {searching ? <><Loader2 className="w-4 h-4 animate-spin" /> Searching…</> : <><Search className="w-4 h-4" /> Search</>}
            </button>
          </form>

          {searchResults.length > 0 && (
            <div className="max-h-60 overflow-y-auto space-y-2">
              <p className="text-xs text-gray-400">Pick the exact version you want to sing:</p>
              {searchResults.map((song, idx) => (
                <button
                  key={`${song.videoId}-${idx}`}
                  onClick={() => selectSong(song)}
                  className="w-full text-left p-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors flex items-center gap-3"
                >
                  {song.thumbnails?.[0] && <img src={song.thumbnails[0].url} alt="" className="w-12 h-12 rounded object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{song.title}</p>
                    <p className="text-sm text-gray-400 truncate">{song.artist}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {song.duration && <span>{formatDuration(song.duration)}</span>}
                      {song.album && <span className="truncate">{song.album}</span>}
                    </div>
                  </div>
                  <Play className="w-6 h-6 text-cyan-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Confirm & Generate */}
      {step === 'confirm' && selectedSong && (
        <div className="space-y-4">
          <button onClick={() => { setStep('search'); setSelectedSong(null); setError(null); }}
            className="text-sm text-gray-400 hover:text-gray-200 flex items-center gap-1">
            <Search className="w-4 h-4" /> Back to results
          </button>

          <div className="flex items-center gap-4 p-4 bg-gray-800 rounded-lg border border-cyan-700/50">
            {(songDetails?.thumbnails?.slice(-1)[0] || selectedSong.thumbnails?.[0]) && (
              <img src={(songDetails?.thumbnails?.slice(-1)[0] || selectedSong.thumbnails![0]).url} alt="" className="w-20 h-20 rounded object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold text-white truncate">{selectedSong.title}</p>
              <p className="text-gray-400 truncate">{selectedSong.artist}</p>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 flex-wrap">
                {(songDetails?.duration || selectedSong.duration) && <span>⏱️ {formatDuration(songDetails?.duration || selectedSong.duration)}</span>}
                {detailsLoading && <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> checking lyrics…</span>}
                {songDetails && (songDetails.hasTimedLyrics
                  ? <span className="text-green-400">📝 Timed lyrics available</span>
                  : songDetails.hasLyrics
                    ? <span className="text-green-300">📝 Lyrics found — they'll be timed to the singing</span>
                    : <span className="text-yellow-400">📝 Lyrics will be looked up on LRCLIB</span>)}
              </div>
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <p className="text-sm text-gray-300 mb-3">This will:</p>
            <ul className="text-sm text-gray-400 space-y-2">
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Download this song's audio</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Separate the vocals from the music (Demucs)</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Turn the singing into melody notes (pYIN)</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Fetch lyrics and line them up with the vocals</li>
            </ul>
            <p className="text-xs text-yellow-400 mt-3">⏱️ Usually 2–5 minutes on a laptop. The first run also downloads the Demucs model (~80 MB).</p>
          </div>

          <button
            onClick={startGeneration}
            disabled={!!setupNeeded}
            className="w-full bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-500 hover:to-purple-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed py-3 rounded-lg font-bold flex items-center justify-center gap-2"
          >
            <Download className="w-5 h-5" /> {setupNeeded ? 'Finish setup to generate' : 'Generate Song Pack'}
          </button>
        </div>
      )}

      {/* Step 3: Generating */}
      {step === 'generating' && (
        <div className="bg-gray-800 rounded-lg p-4 border border-purple-700/50">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-bold text-white">Generating song pack</p>
              <p className="text-sm text-gray-400 truncate">{selectedSong?.title} — {selectedSong?.artist}</p>
            </div>
          </div>
          <div className="flex justify-between text-sm mb-1 gap-2">
            <span className="text-purple-200 truncate">
              {generationJob?.status === 'pending' && (generationJob.queuePosition ?? 0) > 1
                ? `Waiting — #${generationJob.queuePosition} in line`
                : generationJob?.progress || 'Starting…'}
            </span>
            <span className="text-purple-300 font-mono">{percent}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-purple-500 to-purple-300 transition-all duration-700" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">This runs on the server — you can keep setting up the game meanwhile.</p>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && generationJob?.result && (
        <div className="space-y-4">
          <div className="bg-green-900/30 border border-green-600 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-bold text-green-200">Song pack ready and loaded</p>
              <p className="text-sm text-gray-300 truncate">{generationJob.result.title}</p>
              <p className="text-xs text-gray-400 mt-1">
                {generationJob.result.noteCount} notes · {generationJob.result.lyricCount} lyric lines ({LYRICS_LABEL[generationJob.result.lyricsSource] || generationJob.result.lyricsSource})
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-400 text-center">If lyrics feel early or late while playing, tap [ or ] to nudge them — it's saved.</p>
          <button onClick={reset} className="w-full bg-cyan-600 hover:bg-cyan-500 py-2 rounded font-bold">Search for another song</button>
        </div>
      )}
    </div>
  );
};

export default AutoSongSearch;
