import React, { useState, useCallback } from 'react';
import { socketClient } from '../services/socketClient';
import { Music, Search, Loader2, CheckCircle, AlertCircle, Download, Play, XCircle } from 'lucide-react';

interface SongSearchResult {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  duration?: string;
  thumbnails?: Array<{ url: string }>;
  lyricsId?: string;
}

interface SongDetails {
  videoId: string;
  title: string;
  artist: string;
  duration?: string;
  lyrics?: string;
  thumbnails?: Array<{ url: string }>;
}

interface GenerationJob {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: string;
  result?: { songId: string; title: string; videoId: string };
  error?: string;
}

interface AutoSongSearchProps {
  onSongReady: (songId: string, songData: any) => void;
  isLoading?: boolean;
}

export const AutoSongSearch: React.FC<AutoSongSearchProps> = ({ onSongReady, isLoading = false }) => {
  const [query, setQuery] = useState('');
  const [lyricsOnly, setLyricsOnly] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SongSearchResult[]>([]);
  const [selectedSong, setSelectedSong] = useState<SongSearchResult | null>(null);
  const [songDetails, setSongDetails] = useState<SongDetails | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationJob, setGenerationJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'search' | 'confirm' | 'generating' | 'complete'>('search');

  const apiBase = '/api';

  const searchSongs = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    
    setSearching(true);
    setError(null);
    
    try {
      const res = await fetch(`${apiBase}/songs/search?q=${encodeURIComponent(searchQuery)}&limit=10&lyricsOnly=${lyricsOnly}`);
      const data = await res.json();
      
      if (res.ok) {
        setSearchResults(data);
        setStep('search');
      } else {
        setError(data.error || 'Search failed');
      }
    } catch (err) {
      setError('Failed to search. Is the server running?');
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchSongs(query);
  };

  const selectSong = useCallback(async (song: SongSearchResult) => {
    setSelectedSong(song);
    setStep('confirm');
    
    // Fetch details (lyrics, etc.)
    try {
      const res = await fetch(`${apiBase}/songs/details/${song.videoId}`);
      const data = await res.json();
      if (res.ok) {
        setSongDetails(data);
      }
    } catch (err) {
      console.warn('Could not fetch song details:', err);
    }
  }, []);

  const startGeneration = useCallback(async () => {
    if (!selectedSong) return;
    
    setGenerating(true);
    setStep('generating');
    setError(null);
    
    try {
      const res = await fetch(`${apiBase}/songs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query,
          songId: selectedSong.videoId,
        }),
      });
      
      const data = await res.json();
      
      if (res.ok && data.jobId) {
        pollGenerationStatus(data.jobId);
      } else {
        setError(data.error || 'Failed to start generation');
        setGenerating(false);
        setStep('confirm');
      }
    } catch (err) {
      setError('Failed to start generation');
      setGenerating(false);
      setStep('confirm');
    }
  }, [selectedSong, query]);

  const pollGenerationStatus = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`${apiBase}/songs/generate/${jobId}/status`);
      const job = await res.json();
      
      if (res.ok) {
        setGenerationJob(job);
        
        if (job.status === 'completed') {
          setStep('complete');
          setGenerating(false);
          
          // Fetch the generated song pack
          if (job.result?.songId) {
            try {
              const packRes = await fetch(`${apiBase}/songs/${job.result.songId}/pack`);
              const pack = await packRes.json();
              if (packRes.ok) {
                onSongReady(job.result.songId, pack);
              }
            } catch (err) {
              console.error('Failed to load generated pack:', err);
            }
          }
        } else if (job.status === 'failed') {
          setError(job.error || 'Generation failed');
          setGenerating(false);
          setStep('confirm');
        } else {
          // Still running, poll again
          setTimeout(() => pollGenerationStatus(jobId), 3000);
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
      setTimeout(() => pollGenerationStatus(jobId), 5000);
    }
  }, [onSongReady]);

  const reset = () => {
    setQuery('');
    setSearchResults([]);
    setSelectedSong(null);
    setSongDetails(null);
    setGenerationJob(null);
    setError(null);
    setStep('search');
  };

  const formatDuration = (seconds?: string | number) => {
    if (!seconds) return 'Unknown';
    const secs = typeof seconds === 'string' ? parseInt(seconds) : seconds;
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}:${rem.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gray-900/50 rounded-xl p-4 md:p-6 border border-cyan-700/50">
      <div className="flex items-center gap-2 mb-4">
        <Music className="w-5 h-5 text-cyan-400" />
        <h3 className="text-lg font-bold text-cyan-300">Auto Song Generator</h3>
        <span className="text-xs bg-cyan-900/50 text-cyan-300 px-2 py-0.5 rounded">
          Powered by YTMusic + Demucs + basic-pitch
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-600 rounded-lg flex items-center gap-2 text-red-200">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Step 1: Search */}
      {step === 'search' && (
        <div className="space-y-4">
          <form onSubmit={handleSearch} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for a song (e.g., 'APT ROSÉ Bruno Mars')"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white placeholder-gray-500"
                disabled={searching}
                autoFocus
              />
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 px-4 py-2 rounded font-bold flex items-center gap-2"
              >
                {searching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Search
                  </>
                )}
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={lyricsOnly}
                onChange={(e) => setLyricsOnly(e.target.checked)}
                className="w-4 h-4 text-cyan-500 border-gray-600 rounded focus:ring-cyan-500"
              />
              <span>Only show songs with lyrics</span>
            </label>
          </form>

          {searchResults.length > 0 && (
            <div className="max-h-60 overflow-y-auto space-y-2">
              <p className="text-xs text-gray-400">Click a song to select:</p>
              {searchResults.map((song, idx) => (
                <button
                  key={`${song.videoId}-${idx}`}
                  onClick={() => selectSong(song)}
                  className="w-full text-left p-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors flex items-center gap-3"
                >
                  {song.thumbnails?.[0] && (
                    <img
                      src={song.thumbnails[0].url}
                      alt=""
                      className="w-12 h-12 rounded object-cover"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{song.title}</p>
                    <p className="text-sm text-gray-400 truncate">{song.artist}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {song.duration && <span>{formatDuration(song.duration)}</span>}
                      {song.album && <span>{song.album}</span>}
                      {song.hasLyrics ? (
                        <span className="text-green-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Lyrics available
                        </span>
                      ) : song.lyricsId === null ? (
                        <span className="text-yellow-400 flex items-center gap-1">
                          <span className="w-3 h-3" /> Check lyrics
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> No lyrics
                        </span>
                      )}
                    </div>
                  </div>
                  <Play className="w-6 h-6 text-cyan-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Confirm & Generate */}
      {step === 'confirm' && selectedSong && (
        <div className="space-y-4">
          <button
            onClick={() => { setStep('search'); setSelectedSong(null); }}
            className="text-sm text-gray-400 hover:text-gray-200 flex items-center gap-1"
          >
            <Search className="w-4 h-4" /> Back to search
          </button>

          <div className="flex items-center gap-4 p-4 bg-gray-800 rounded-lg border border-cyan-700/50">
            {songDetails?.thumbnails?.[0] && (
              <img
                src={songDetails.thumbnails[0].url}
                alt=""
                className="w-20 h-20 rounded object-cover"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold text-white">{selectedSong.title}</p>
              <p className="text-gray-400">{selectedSong.artist}</p>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                {songDetails?.duration && <span>⏱️ {formatDuration(songDetails.duration)}</span>}
                {songDetails?.lyrics && <span className="text-green-400">📝 Lyrics found</span>}
              </div>
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <p className="text-sm text-gray-300 mb-3">
              This will automatically:
            </p>
            <ul className="text-sm text-gray-400 space-y-2">
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Download audio from YouTube</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Separate vocals + instrumental (Demucs)</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Extract melody MIDI (basic-pitch)</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Fetch synced lyrics from YouTube Music</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Create song.json pack</li>
            </ul>
            <p className="text-xs text-yellow-400 mt-3">
              ⚠️ Takes 2-5 minutes depending on song length. Requires Python + Demucs + basic-pitch on server.
            </p>
          </div>

          <button
            onClick={startGeneration}
            disabled={generating}
            className="w-full bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-500 hover:to-purple-700 py-3 rounded-lg font-bold flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Starting generation...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Generate Song Pack
              </>
            )}
          </button>
        </div>
      )}

      {/* Step 3: Generating */}
      {step === 'generating' && generationJob && (
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-purple-700/50">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
              <div>
                <p className="font-bold text-white">Generating Song Pack</p>
                <p className="text-sm text-gray-400">{selectedSong?.title}</p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Status:</span>
                <span className="text-purple-300 font-mono">{generationJob.progress}</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-purple-500 to-purple-400 animate-pulse"
                  style={{ width: generationJob.status === 'completed' ? '100%' : '60%' }}
                />
              </div>
            </div>
            
            <p className="text-xs text-gray-500 mt-2">
              This runs on the server. You can close this window and check back later.
              Job ID: <code className="text-gray-400">{generationJob.jobId}</code>
            </p>
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && generationJob?.result && (
        <div className="space-y-4">
          <div className="bg-green-900/30 border border-green-600 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-400" />
              <div>
                <p className="font-bold text-green-200">Song Pack Ready!</p>
                <p className="text-sm text-gray-300">{generationJob.result.title}</p>
              </div>
            </div>
          </div>
          
          <p className="text-sm text-gray-400 text-center">
            The song has been added to your library. You can now select it from the Song Packs dropdown.
          </p>
          
          <button
            onClick={reset}
            className="w-full bg-cyan-600 hover:bg-cyan-500 py-2 rounded font-bold"
          >
            Search for Another Song
          </button>
        </div>
      )}
    </div>
  );
};

export default AutoSongSearch;