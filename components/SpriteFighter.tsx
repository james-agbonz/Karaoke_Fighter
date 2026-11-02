import React, { useEffect, useRef, useState } from 'react';

interface FighterProps {
  side: 'left' | 'right';
  isAttacking: boolean;
  isDamaged: boolean;
  isComboAttacking?: boolean;
  isGuarding?: boolean;   // true for the player who is NOT singing this segment
  comboCount?: number;
  hp: number;
  maxHp: number;
  name: string;
  score: number;
}

// ============ SPRITE CONFIG ============
// LuizMelo "Martial Hero" (Mack) & "Martial Hero 2" (Kenji) — free to use, credit in public/sprites/CREDITS.md
// Horizontal strips of 200x200 frames. Mack faces RIGHT (P1), Kenji faces LEFT (P2).

const FRAME = 200;
const VIEW_W = 224; // viewport size (w-56 / h-72)
const VIEW_H = 288;

interface AnimDef { file: string; frames: number; fps: number; holdLast?: boolean }
interface CharDef {
  base: string;
  scale: number;
  offsetX: number; // shift of the scaled frame inside the viewport — tune to center character
  offsetY: number;
  guard: { anim: string; frame: number }; // held pose while defending (packs have no block anim)
  anims: Record<string, AnimDef>;
}

const CHARACTERS: Record<'left' | 'right', CharDef> = {
  left: {
    base: '/sprites/samuraiMack',
    scale: 2.6, offsetX: -132, offsetY: -43, // measured: idle center -> viewport center, feet -> floor
    guard: { anim: 'jump', frame: 0 }, // crouched brace
    anims: {
      idle:    { file: 'Idle.png',    frames: 8, fps: 10 },
      attack1: { file: 'Attack1.png', frames: 6, fps: 14 },
      attack2: { file: 'Attack2.png', frames: 6, fps: 14 },
      jump:    { file: 'Jump.png',    frames: 2, fps: 8 },
      fall:    { file: 'Fall.png',    frames: 2, fps: 8 },
      takeHit: { file: 'TakeHit.png', frames: 4, fps: 12 },
      death:   { file: 'Death.png',   frames: 6, fps: 10, holdLast: true },
    },
  },
  right: {
    base: '/sprites/kenji',
    scale: 2.6, offsetX: -153, offsetY: -59, // measured: idle center -> viewport center, feet -> floor
    guard: { anim: 'jump', frame: 0 },
    anims: {
      idle:    { file: 'Idle.png',    frames: 4, fps: 8 },
      attack1: { file: 'Attack1.png', frames: 4, fps: 12 },
      attack2: { file: 'Attack2.png', frames: 4, fps: 12 },
      jump:    { file: 'Jump.png',    frames: 2, fps: 8 },
      fall:    { file: 'Fall.png',    frames: 2, fps: 8 },
      takeHit: { file: 'TakeHit.png', frames: 3, fps: 12 },
      death:   { file: 'Death.png',   frames: 7, fps: 10, holdLast: true },
    },
  },
};

// ============ MOVES & TIERS ============
type Move = 'idle' | 'attack1' | 'attack2' | 'leap' | 'hit' | 'death';
interface Segment { anim: string; until: number }

const MOVE_SCRIPT: Record<Move, Segment[]> = {
  idle:    [{ anim: 'idle', until: 1 }],
  attack1: [{ anim: 'attack1', until: 1 }],
  attack2: [{ anim: 'attack2', until: 1 }],
  leap:    [{ anim: 'jump', until: 0.22 }, { anim: 'attack2', until: 0.75 }, { anim: 'fall', until: 1 }],
  hit:     [{ anim: 'takeHit', until: 1 }],
  death:   [{ anim: 'death', until: 1 }],
};

function moveDuration(move: Move, char: CharDef): number {
  if (move === 'idle') return Infinity;
  return MOVE_SCRIPT[move].reduce((total, seg) => {
    const anim = char.anims[seg.anim];
    return total + (anim.frames / anim.fps) * 1000;
  }, 0);
}

function getFrame(move: Move, progress: number, char: CharDef, t: number): { anim: AnimDef; frame: number } {
  if (move === 'idle') {
    const anim = char.anims.idle;
    return { anim, frame: Math.floor((t / 1000) * anim.fps) % anim.frames };
  }
  const script = MOVE_SCRIPT[move];
  let segStart = 0;
  for (const seg of script) {
    if (progress <= seg.until || seg === script[script.length - 1]) {
      const anim = char.anims[seg.anim];
      const local = (progress - segStart) / (seg.until - segStart);
      let frame = Math.floor(Math.min(local, 0.999) * anim.frames);
      if (anim.holdLast && progress >= 1) frame = anim.frames - 1;
      return { anim, frame: Math.max(0, Math.min(frame, anim.frames - 1)) };
    }
    segStart = seg.until;
  }
  return { anim: char.anims.idle, frame: 0 };
}

function tierOf(combo: number): 1 | 2 | 3 {
  if (combo >= 18) return 3;
  if (combo >= 8) return 2;
  return 1;
}

function pickMove(combo: number): Move {
  const tier = tierOf(combo);
  const r = Math.random();
  if (tier === 1) return 'attack1';
  if (tier === 2) return r < 0.55 ? 'attack1' : 'attack2';
  if (r < 0.4) return 'leap';
  if (r < 0.8) return 'attack2';
  return 'attack1';
}

// Keep chaining attacks while the game reported a hit this recently
const ATTACK_HOLD_MS = 300;

// ============ COMPONENT ============
const SpriteFighter: React.FC<FighterProps> = ({
  side, isAttacking, isDamaged, isGuarding = false, comboCount = 0, hp, maxHp, name, score,
}) => {
  const isLeft = side === 'left';
  const char = CHARACTERS[side];
  const hpPercent = maxHp > 0 ? (hp / maxHp) * 100 : 0;

  const [display, setDisplay] = useState<{ anim: AnimDef; frame: number }>(
    () => ({ anim: char.anims.idle, frame: 0 })
  );
  const moveRef = useRef<Move>('idle');
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const comboRef = useRef<number>(comboCount);
  const guardRef = useRef<boolean>(isGuarding);
  const deadRef = useRef<boolean>(false);
  const prevAttack = useRef(false);
  const prevDamage = useRef(false);
  // Last time the game said "this fighter is landing hits". While hits keep coming,
  // attacks chain one after another; each animation plays to the end instead of
  // restarting on every hit (which made fighters look frozen).
  const attackSignalAtRef = useRef(0);
  if (isAttacking) attackSignalAtRef.current = performance.now();

  useEffect(() => { comboRef.current = comboCount; }, [comboCount]);
  useEffect(() => { guardRef.current = isGuarding; }, [isGuarding]);

  useEffect(() => {
    Object.values(char.anims).forEach((a: AnimDef) => { const img = new Image(); img.src = `${char.base}/${a.file}`; });
  }, [char]);

  const trigger = (m: Move) => { moveRef.current = m; startRef.current = performance.now(); };

  useEffect(() => {
    if (hp <= 0 && !deadRef.current) { deadRef.current = true; trigger('death'); }
    if (hp > 0 && deadRef.current) { deadRef.current = false; trigger('idle'); }
  }, [hp]);

  useEffect(() => {
    if (deadRef.current) return;
    if (isDamaged && !prevDamage.current && moveRef.current !== 'hit') {
      trigger('hit');                         // a hit reaction already playing finishes first
    } else if (isAttacking && moveRef.current === 'idle') {
      trigger(pickMove(comboRef.current));    // an attack already playing finishes first
    }
    prevAttack.current = isAttacking;
    prevDamage.current = isDamaged;
  }, [isAttacking, isDamaged]);

  useEffect(() => {
    const loop = (now: number) => {
      const move = moveRef.current;
      const dur = moveDuration(move, char);
      const elapsed = now - startRef.current;
      let progress = dur === Infinity ? 0 : Math.min(elapsed / dur, 1);
      if (dur !== Infinity && elapsed >= dur && move !== 'death') {
        moveRef.current = 'idle'; startRef.current = now; progress = 0;
      }
      // Still landing hits? Go straight into the next attack.
      if (moveRef.current === 'idle' && !deadRef.current && now - attackSignalAtRef.current < ATTACK_HOLD_MS) {
        moveRef.current = pickMove(comboRef.current); startRef.current = now; progress = 0;
      }
      // Guard overrides idle only — attacks, hits, and death play out fully
      if (moveRef.current === 'idle' && guardRef.current) {
        const g = char.anims[char.guard.anim];
        setDisplay({ anim: g, frame: char.guard.frame });
      } else {
        setDisplay(getFrame(moveRef.current, progress, char, now));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [char]);

  const inHit = moveRef.current === 'hit';
  const guardingNow = isGuarding && moveRef.current === 'idle' && !deadRef.current;
  const tier = tierOf(comboCount);
  const scaled = FRAME * char.scale;

  return (
    <div className="flex flex-col items-center relative">
      <div className={`mb-2 w-48 ${isLeft ? 'text-left' : 'text-right'}`}>
        <p className="text-3xl md:text-4xl font-black text-white">{score.toString().padStart(5, '0')}</p>
      </div>

      <div className={`mb-1 w-48 ${isLeft ? 'text-left' : 'text-right'}`}>
        <p className="text-sm font-bold uppercase tracking-widest text-yellow-400 mb-1">{name}</p>
        <div className="w-full h-4 bg-gray-800 border-2 border-white overflow-hidden rounded-full">
          <div className={`h-full transition-all duration-300 ${hpPercent > 50 ? 'bg-green-500' : hpPercent > 20 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${hpPercent}%` }} />
        </div>
      </div>

      <div className={`mb-2 w-48 ${isLeft ? 'text-left' : 'text-right'}`}>
        <div className="flex items-center gap-2" style={{ flexDirection: isLeft ? 'row' : 'row-reverse' }}>
          <span className={`text-xs font-bold ${tier === 3 ? 'text-amber-400' : tier === 2 ? 'text-purple-400' : 'text-teal-400'}`}>T{tier}</span>
          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full transition-all duration-200 ${tier === 3 ? 'bg-amber-400' : tier === 2 ? 'bg-purple-400' : 'bg-teal-400'}`}
              style={{ width: `${Math.min(comboCount / 24 * 100, 100)}%` }} />
          </div>
        </div>
      </div>

      {/* Open-stage sprite viewport — no box, fighter stands on the arena floor */}
      <div className="relative" style={{ width: VIEW_W, height: VIEW_H, overflow: 'visible' }}>
        {/* floor shadow */}
        <div style={{
          position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)',
          width: 135, height: 22, borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 70%)',
        }} />
        {/* sprite frame */}
        <div
          style={{
            position: 'absolute',
            left: char.offsetX,
            top: char.offsetY,
            width: scaled,
            height: scaled,
            backgroundImage: `url(${char.base}/${display.anim.file})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${display.anim.frames * scaled}px ${scaled}px`,
            backgroundPosition: `-${display.frame * scaled}px 0px`,
            imageRendering: 'pixelated',
            filter: inHit ? 'brightness(1.7) saturate(2.5) hue-rotate(-30deg)' : 'none',
            transition: 'filter 80ms',
          }}
        />
        {guardingNow && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-[0.25em] text-blue-300/90 bg-black/50 px-2 py-0.5 rounded">GUARD</span>
        )}
        {inHit && (
          <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none">
            <span className="text-4xl font-black text-red-500 animate-ping">HIT!</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpriteFighter;
