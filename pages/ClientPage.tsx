import React, { useState, useEffect, useRef } from 'react';
import { socketClient } from '../services/socketClient';
import { detectPitch } from '../services/pitchDetection';
import { startMicCapture, type MicCapture } from '../services/micCapture';
import { GamePhase } from '../types';
import type { PlayerSlot, GameState } from '../types';
import { Mic, MicOff, CheckCircle, Loader2, Wifi, WifiOff } from 'lucide-react';

const ClientPage: React.FC = () => {
  // Get player slot from URL
  const urlParams = new URLSearchParams(window.location.search);
  const requestedSlot = parseInt(urlParams.get('p') || '0', 10) as PlayerSlot | 0;

  // Connection state
  const [connected, setConnected] = useState(false);
  const [assignedSlot, setAssignedSlot] = useState<PlayerSlot | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mic state
  const [micEnabled, setMicEnabled] = useState(false);
  const [currentPitch, setCurrentPitch] = useState(-1);
  const [volume, setVolume] = useState(0);

  // Audio: capture runs on the audio clock, so it keeps working when this page is in the background
  const captureRef = useRef<MicCapture | null>(null);
  const wakeLockRef = useRef<any>(null);
  
  // Refs to avoid stale closure in mic loop
  const gameStartedRef = useRef(false);
  const assignedSlotRef = useRef<PlayerSlot | null>(null);
  const frameCountRef = useRef(0);

  // Connect to server
  useEffect(() => {
    const connect = async () => {
      try {
        await socketClient.connect();
        socketClient.joinAsPlayer(requestedSlot || undefined);
        setConnected(true);
      } catch (err) {
        console.error('Failed to connect:', err);
        setError('Failed to connect to server. Is the server running?');
      }
    };

    connect();

    // Socket event handlers
    socketClient.on('player_assigned', (data: { slot: PlayerSlot }) => {
      setAssignedSlot(data.slot);
      assignedSlotRef.current = data.slot;
      console.log(`[Client] ✅ Assigned as Player ${data.slot}`);
    });

    socketClient.on('error', (data: { message: string }) => {
      setError(data.message);
    });

    socketClient.on('game_start', () => {
      console.log('[Client] ✅ GAME_START event received - pitch transmission now enabled');
      setGameStarted(true);
      gameStartedRef.current = true;
      keepScreenOn();
    });

    socketClient.on('game_state', (state: GameState) => {
      setGameState(state);
    });

    socketClient.on('game_over', () => {
      setGameStarted(false);
      gameStartedRef.current = false;   // stop sending; keep the mic open for the next round
      releaseScreen();
    });

    socketClient.on('disconnected', () => {
      setConnected(false);
      setError('Disconnected from server');
    });

    // A phone's screen lock is released whenever the page is hidden: take it again on return
    const onVisible = () => { if (document.visibilityState === 'visible' && gameStartedRef.current) keepScreenOn(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      socketClient.disconnect();
      stopMic();
      releaseScreen();
    };
  }, [requestedSlot]);

  // Stop phones from going to sleep mid-song (a sleeping phone can't hear you)
  const keepScreenOn = async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current.addEventListener?.('release', () => { wakeLockRef.current = null; });
      }
    } catch { /* not supported or not allowed: fine */ }
  };
  const releaseScreen = () => {
    try { wakeLockRef.current?.release(); } catch { /* ignore */ }
    wakeLockRef.current = null;
  };

  // Enable microphone
  const enableMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      captureRef.current = await startMicCapture(stream, handleFrame);

      setMicEnabled(true);
      console.log(`[Client] ✅ Microphone enabled (${captureRef.current.sampleRate} Hz), pitch detection running`);
    } catch (err: any) {
      console.error('Mic error:', err);
      if (err.name === 'NotAllowedError') {
        setError('Microphone access denied. Please allow microphone access.');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found.');
      } else {
        setError('Failed to access microphone.');
      }
    }
  };

  // Called for every audio frame (~21 ms apart), even when this page is in the background
  const handleFrame = (frame: Float32Array, sampleRate: number) => {
    const { pitch, rms } = detectPitch(frame, sampleRate);
    frameCountRef.current++;

    // Send ~23 times a second while the game runs — including "silent" (-1), so the host
    // knows you stopped singing instead of holding on to your last note.
    const slot = assignedSlotRef.current;
    if (gameStartedRef.current && slot && frameCountRef.current % 2 === 0) {
      socketClient.sendPitchData(slot, pitch > 0 ? pitch : -1, Date.now(), rms);
    }

    // Screen readout ~15 times a second is plenty
    if (frameCountRef.current % 3 === 0) {
      setCurrentPitch(pitch);
      setVolume(rms);
    }
  };

  const stopMic = () => {
    captureRef.current?.stop();
    captureRef.current = null;
  };

  // Set ready
  const handleReady = () => {
    if (assignedSlot) {
      socketClient.setReady(assignedSlot);
      setIsReady(true);
    }
  };

  // Get player's current state from game state
  const myState = gameState && assignedSlot 
    ? (assignedSlot === 1 ? gameState.player1 : gameState.player2)
    : null;

  const isMyTurn = gameState && assignedSlot === gameState.attackingPlayer;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-cyan-500 mb-2">KARAOKE COMBAT</h1>
          <p className="text-yellow-500">
            {assignedSlot ? `PLAYER ${assignedSlot}` : 'CONNECTING...'}
          </p>
        </div>

        {/* Connection Status */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {connected ? (
            <>
              <Wifi className="w-5 h-5 text-green-500" />
              <span className="text-green-500">Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="w-5 h-5 text-red-500" />
              <span className="text-red-500">Disconnected</span>
            </>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6 text-center">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Pre-game: Enable Mic & Ready */}
        {!gameStarted && (
          <div className="space-y-6">
            {/* Mic Enable Button */}
            <button
              onClick={enableMic}
              disabled={micEnabled}
              className={`w-full py-6 rounded-xl font-bold text-xl flex items-center justify-center gap-4 ${
                micEnabled
                  ? 'bg-green-600 cursor-default'
                  : 'bg-cyan-600 hover:bg-cyan-500'
              }`}
            >
              {micEnabled ? (
                <>
                  <Mic className="w-8 h-8" />
                  Microphone Enabled
                </>
              ) : (
                <>
                  <MicOff className="w-8 h-8" />
                  Enable Microphone
                </>
              )}
            </button>

            {/* Pitch Display (for testing) */}
            {micEnabled && (
              <div className="bg-gray-900 rounded-lg p-4">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Detected Pitch</span>
                  <span className="text-cyan-400 font-mono">
                    {currentPitch > 0 ? `${Math.round(currentPitch)} Hz` : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Volume</span>
                  <span className="text-cyan-400 font-mono">
                    {(volume * 100).toFixed(1)}%
                  </span>
                </div>
                {/* Volume meter */}
                <div className="mt-2 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-cyan-500 transition-all duration-75"
                    style={{ width: `${Math.min(100, volume * 500)}%` }}
                  />
                </div>
                
                {/* Debug Status */}
                <div className="mt-4 pt-4 border-t border-gray-700 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Game Started:</span>
                    <span className={gameStarted ? 'text-green-400' : 'text-red-400'}>
                      {gameStarted ? '✅ YES' : '❌ NO'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Assigned Slot:</span>
                    <span className={assignedSlot ? 'text-green-400' : 'text-red-400'}>
                      {assignedSlot ? `✅ P${assignedSlot}` : '❌ None'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Pitch Transmission:</span>
                    <span className={gameStarted && assignedSlot && currentPitch > 0 ? 'text-green-400' : 'text-yellow-400'}>
                      {gameStarted && assignedSlot && currentPitch > 0 ? '✅ ACTIVE' : '⏸️ WAITING'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Ready Button */}
            <button
              onClick={handleReady}
              disabled={!micEnabled || isReady || !assignedSlot}
              className={`w-full py-6 rounded-xl font-bold text-xl flex items-center justify-center gap-4 ${
                isReady
                  ? 'bg-green-600 cursor-default'
                  : micEnabled && assignedSlot
                    ? 'bg-yellow-600 hover:bg-yellow-500'
                    : 'bg-gray-700 cursor-not-allowed'
              }`}
            >
              {isReady ? (
                <>
                  <CheckCircle className="w-8 h-8" />
                  READY! Waiting for game...
                </>
              ) : (
                <>
                  <Loader2 className="w-8 h-8" />
                  Press to Ready Up
                </>
              )}
            </button>
          </div>
        )}

        {/* In-game Display */}
        {gameStarted && gameState && (
          <div className="space-y-6">
            {/* Turn Indicator */}
            <div className={`text-center p-4 rounded-lg ${
              isMyTurn ? 'bg-cyan-600 animate-pulse' : 'bg-gray-800'
            }`}>
              <p className="text-2xl font-black">
                {isMyTurn ? '🎤 YOUR TURN - SING!' : '🛡️ DEFEND'}
              </p>
              <p className="text-sm mt-1">
                Segment {gameState.currentSegment}/4
              </p>
            </div>

            {/* HP Display */}
            {myState && (
              <div className="bg-gray-900 rounded-lg p-4">
                <div className="flex justify-between mb-2">
                  <span>Your HP</span>
                  <span className="font-bold">{Math.round(myState.hp)}/{myState.maxHp}</span>
                </div>
                <div className="h-4 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      (myState.hp / myState.maxHp * 100) > 50 ? 'bg-green-500' : (myState.hp / myState.maxHp * 100) > 20 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${(myState.hp / myState.maxHp) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Pitch Display */}
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="text-center">
                <p className="text-gray-400 text-sm">Your Pitch</p>
                <p className="text-4xl font-black text-cyan-400">
                  {currentPitch > 0 ? `${Math.round(currentPitch)}` : '—'}
                </p>
                <p className="text-gray-500 text-sm">Hz</p>
              </div>
              
              {/* Volume meter */}
              <div className="mt-4 h-3 bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-75 ${
                    isMyTurn ? 'bg-cyan-500' : 'bg-gray-600'
                  }`}
                  style={{ width: `${Math.min(100, volume * 500)}%` }}
                />
              </div>
            </div>

            {/* Score */}
            {myState && (
              <div className="text-center">
                <p className="text-gray-400">Your Score</p>
                <p className="text-3xl font-black">{myState.score}</p>
              </div>
            )}
          </div>
        )}

        {/* Game Over */}
        {gameState?.phase === GamePhase.GAME_OVER && (
          <div className="text-center mt-8">
            <h2 className="text-4xl font-black text-yellow-400 mb-4">
              {gameState.winner === assignedSlot 
                ? '🏆 YOU WIN!' 
                : gameState.winner === 'tie'
                  ? "IT'S A TIE!"
                  : '💀 YOU LOSE'}
            </h2>
            <button
              onClick={() => window.location.reload()}
              className="bg-cyan-600 hover:bg-cyan-500 px-6 py-3 rounded-lg font-bold"
            >
              Play Again
            </button>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>Sing into your microphone to attack!</p>
          <p>Match the pitch shown on the host screen.</p>
        </div>
      </div>
    </div>
  );
};

export default ClientPage;
