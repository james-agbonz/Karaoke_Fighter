import { GamePhase } from '../types';
import type { PlayerSlot, PlayerState, GameState, MidiNote } from '../types';

// ============ CONSTANTS ============
export const DEFAULT_HP = 20000;
export const DAMAGE_PER_HIT = 2;
export const SCORE_PER_HIT = 10;
export const COMBO_THRESHOLD = 10; // Notes between damage bursts
export const COMBO_MAX = 24; // ceiling for the combo meter (Tier 3 territory)

// Bigger combos hit harder: Tier 1 = x1, Tier 2 = x2, Tier 3 = x3
export function comboTierMultiplier(comboCount: number): number {
  if (comboCount >= 18) return 3;
  if (comboCount >= 8) return 2;
  return 1;
}
export const PERFECT_THRESHOLD_CENTS = 10;
export const GOOD_THRESHOLD_CENTS = 25;
// How far off-key still counts as a hit. 100 cents = within one semitone ("medium" in
// karaoke games); 50 was "hard" and real singers missed most notes. Lower it for a harder game.
export const OK_THRESHOLD_CENTS = 100;

// Timing allowance around each note. Your voice reaches the host ~0.1–0.25 s after you sing
// (mic window + network), and most melody notes only last 0.1–0.2 s, so without this a
// perfect singer would miss most of them.
export const NOTE_EARLY_S = 0.10;
export const NOTE_LATE_S = 0.25;

// ============ PITCH ACCURACY ============

// Calculate cents difference between two frequencies
export function calculateCentsDiff(expected: number, actual: number): number {
  if (actual <= 0 || expected <= 0) return Infinity;
  return 1200 * Math.log2(actual / expected);
}

// Calculate accuracy score (0-1) based on pitch difference
export function calculatePitchAccuracy(expectedPitch: number, actualPitch: number): number {
  if (actualPitch <= 0) return 0;
  
  // Octave fairness: singing the right note in a different octave counts.
  // Fold the cents difference into [-600, +600] so C3 vs C4 vs C5 all score as C.
  const rawCents = calculateCentsDiff(expectedPitch, actualPitch);
  if (!isFinite(rawCents)) return 0;
  const folded = ((rawCents % 1200) + 1800) % 1200 - 600;
  const centsDiff = Math.abs(folded);
  
  // Perfect: 0-10 cents = 1.0
  if (centsDiff <= PERFECT_THRESHOLD_CENTS) {
    return 1.0;
  }
  
  // Good: 10-25 cents = 0.7-1.0
  if (centsDiff <= GOOD_THRESHOLD_CENTS) {
    return 1.0 - (centsDiff - PERFECT_THRESHOLD_CENTS) / (GOOD_THRESHOLD_CENTS - PERFECT_THRESHOLD_CENTS) * 0.3;
  }
  
  // OK: 25-100 cents = 0.3-0.7
  if (centsDiff <= OK_THRESHOLD_CENTS) {
    return 0.7 - (centsDiff - GOOD_THRESHOLD_CENTS) / (OK_THRESHOLD_CENTS - GOOD_THRESHOLD_CENTS) * 0.4;
  }
  
  // Miss
  return 0;
}

// Notes that can be scored right now: playing, just about to start, or just finished
// (see NOTE_EARLY_S / NOTE_LATE_S). Sorted by start time.
export function getScorableNotes(notes: MidiNote[], time: number): MidiNote[] {
  const out: MidiNote[] = [];
  for (const n of notes) {
    if (n.time - NOTE_EARLY_S > time) break;          // notes are sorted: nothing later can match
    if (time <= n.time + n.duration + NOTE_LATE_S) out.push(n);
  }
  return out;
}

// Best accuracy for a sung pitch against any note in the timing window
function bestAccuracy(notes: MidiNote[], sungPitch: number): number {
  let best = 0;
  for (const n of notes) best = Math.max(best, calculatePitchAccuracy(n.pitch, sungPitch));
  return best;
}

// ============ DAMAGE CALCULATION ============

export function calculateDamage(accuracy: number): number {
  // Flat 2 damage per successful hit (accuracy > 0)
  if (accuracy <= 0) return 0;
  return DAMAGE_PER_HIT;
}

// ============ SEGMENT LOGIC ============

export function getCurrentSegment(currentTime: number, songDuration: number): {
  segment: 1 | 2 | 3 | 4;
  attacker: PlayerSlot;
} {
  if (songDuration <= 0) {
    return { segment: 1, attacker: 1 };
  }
  
  const segmentDuration = songDuration / 4;
  const segmentIndex = Math.floor(currentTime / segmentDuration);
  const segment = Math.min(4, Math.max(1, segmentIndex + 1)) as 1 | 2 | 3 | 4;
  
  // Segment 1 & 3 = Player 1 attacks
  // Segment 2 & 4 = Player 2 attacks
  const attacker: PlayerSlot = (segment === 1 || segment === 3) ? 1 : 2;
  
  return { segment, attacker };
}

// ============ PLAYER STATE ============

export function createInitialPlayerState(slot: PlayerSlot, name: string, maxHp: number = DEFAULT_HP): PlayerState {
  return {
    slot,
    hp: maxHp,
    maxHp: maxHp,
    score: 0,
    totalAccuracy: 0,
    notesHit: 0,
    notesMissed: 0,
    isAttacking: false,
    isDamaged: false,
    currentPitch: -1,
    name,
    damageAccumulator: 0,
    comboCount: 0,
    isComboAttacking: false
  };
}

// ============ GAME STATE ============

export function createInitialGameState(songDuration: number, noteCount: number = 100): GameState {
  // Fixed HP of 20,000 for all players
  const maxHp = DEFAULT_HP;
  
  return {
    phase: GamePhase.LOBBY,
    currentTime: 0,
    songDuration,
    currentSegment: 1,
    attackingPlayer: 1,
    player1: createInitialPlayerState(1, 'Player 1', maxHp),
    player2: createInitialPlayerState(2, 'Player 2', maxHp),
    winner: null
  };
}

// ============ GAME TICK ============

export interface TickResult {
  gameState: GameState;
  p1Damage: number;
  p2Damage: number;
  p1Accuracy: number;
  p2Accuracy: number;
}

export function processGameTick(
  gameState: GameState,
  midiNotes: MidiNote[],
  p1Pitch: number,
  p2Pitch: number,
  currentTime: number
): TickResult {
  const newState = { ...gameState };
  newState.currentTime = currentTime;
  
  // Update segment
  const { segment, attacker } = getCurrentSegment(currentTime, gameState.songDuration);
  newState.currentSegment = segment;
  newState.attackingPlayer = attacker;
  
  // Notes you can score against right now (with the timing allowance)
  const scorable = getScorableNotes(midiNotes, currentTime);
  const currentNote = scorable.length > 0 ? scorable[0] : null;
  
  let p1Damage = 0;
  let p2Damage = 0;
  let p1Accuracy = 0;
  let p2Accuracy = 0;
  
  // Update player pitches
  newState.player1 = { ...newState.player1, currentPitch: p1Pitch };
  newState.player2 = { ...newState.player2, currentPitch: p2Pitch };
  
  if (currentNote) {
    // Calculate accuracy for both players (best match within the timing window)
    p1Accuracy = bestAccuracy(scorable, p1Pitch);
    p2Accuracy = bestAccuracy(scorable, p2Pitch);
    
    // Only attacking player accumulates damage
    if (attacker === 1) {
      if (p1Accuracy > 0) {
        // HIT: climb the combo (capped), keep accumulating damage
        const newComboCount = Math.min(newState.player1.comboCount + 1, COMBO_MAX);
        const newDamageAccum = newState.player1.damageAccumulator + DAMAGE_PER_HIT * comboTierMultiplier(newComboCount);

        // Every COMBO_THRESHOLD notes, dump accumulated damage — but DON'T reset the combo
        const reachedBurst = newComboCount > 0 && newComboCount % COMBO_THRESHOLD === 0;
        p2Damage = reachedBurst ? newDamageAccum : 0;

        newState.player1 = {
          ...newState.player1,
          isAttacking: true,
          isComboAttacking: reachedBurst,
          score: newState.player1.score + SCORE_PER_HIT,
          totalAccuracy: newState.player1.totalAccuracy + p1Accuracy,
          notesHit: newState.player1.notesHit + 1,
          damageAccumulator: reachedBurst ? 0 : newDamageAccum,
          comboCount: newComboCount
        };
        if (reachedBurst) {
          newState.player2 = {
            ...newState.player2,
            isDamaged: true,
            hp: Math.max(0, newState.player2.hp - p2Damage)
          };
        }
      } else {
        // MISS: decay one step, don't freeze
        newState.player1 = {
          ...newState.player1,
          comboCount: Math.max(0, newState.player1.comboCount - 1),
          notesMissed: newState.player1.notesMissed + 1
        };
      }
    } else if (attacker === 2) {
      if (p2Accuracy > 0) {
        // HIT: climb the combo (capped), keep accumulating damage
        const newComboCount = Math.min(newState.player2.comboCount + 1, COMBO_MAX);
        const newDamageAccum = newState.player2.damageAccumulator + DAMAGE_PER_HIT * comboTierMultiplier(newComboCount);

        // Every COMBO_THRESHOLD notes, dump accumulated damage — but DON'T reset the combo
        const reachedBurst = newComboCount > 0 && newComboCount % COMBO_THRESHOLD === 0;
        p1Damage = reachedBurst ? newDamageAccum : 0;

        newState.player2 = {
          ...newState.player2,
          isAttacking: true,
          isComboAttacking: reachedBurst,
          score: newState.player2.score + SCORE_PER_HIT,
          totalAccuracy: newState.player2.totalAccuracy + p2Accuracy,
          notesHit: newState.player2.notesHit + 1,
          damageAccumulator: reachedBurst ? 0 : newDamageAccum,
          comboCount: newComboCount
        };
        if (reachedBurst) {
          newState.player1 = {
            ...newState.player1,
            isDamaged: true,
            hp: Math.max(0, newState.player1.hp - p1Damage)
          };
        }
      } else {
        // MISS: decay one step, don't freeze
        newState.player2 = {
          ...newState.player2,
          comboCount: Math.max(0, newState.player2.comboCount - 1),
          notesMissed: newState.player2.notesMissed + 1
        };
      }
    }
  }
  
  // Game only ends when song ends (no HP-based game over)
  if (currentTime >= gameState.songDuration) {
    newState.phase = GamePhase.GAME_OVER;
    // Determine winner by score
    if (newState.player1.score > newState.player2.score) {
      newState.winner = 1;
    } else if (newState.player2.score > newState.player1.score) {
      newState.winner = 2;
    } else {
      // Tie-breaker: accuracy percentage
      const p1AccPct = newState.player1.notesHit > 0 
        ? newState.player1.totalAccuracy / newState.player1.notesHit 
        : 0;
      const p2AccPct = newState.player2.notesHit > 0 
        ? newState.player2.totalAccuracy / newState.player2.notesHit 
        : 0;
      
      if (p1AccPct > p2AccPct) {
        newState.winner = 1;
      } else if (p2AccPct > p1AccPct) {
        newState.winner = 2;
      } else {
        newState.winner = 'tie';
      }
    }
  }
  
  return {
    gameState: newState,
    p1Damage,
    p2Damage,
    p1Accuracy,
    p2Accuracy
  };
}

// Reset attack/damage animations after a short delay
export function resetAnimationFlags(gameState: GameState): GameState {
  return {
    ...gameState,
    player1: { ...gameState.player1, isAttacking: false, isDamaged: false, isComboAttacking: false },
    player2: { ...gameState.player2, isAttacking: false, isDamaged: false, isComboAttacking: false }
  };
}
