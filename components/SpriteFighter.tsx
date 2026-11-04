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
      run:     { file: 'Run.png',     frames: 8, fps: 14 },
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
      run:     { file: 'Run.png',     frames: 8, fps: 14 },
      jump:    { file: 'Jump.png',    frames: 2, fps: 8 },
      fall:    { file: 'Fall.png',    frames: 2, fps: 8 },
      takeHit: { file: 'TakeHit.png', frames: 3, fps: 12 },
      death:   { file: 'Death.png',   frames: 7, fps: 10, holdLast: true },
    },
  },
};

// ============ MOVES & TIERS ============
// leap = jumping somersault strike toward the opponent; flip = backflip away from them
type Move = 'idle' | 'attack1' | 'attack2' | 'leap' | 'flip' | 'hit' | 'death';
interface Segment { anim: string; until: number }

const MOVE_SCRIPT: Record<Move, Segment[]> = {
  idle:    [{ anim: 'idle', until: 1 }],
  attack1: [{ anim: 'attack1', until: 1 }],
  attack2: [{ anim: 'attack2', until: 1 }],
  leap:    [{ anim: 'jump', until: 0.45 }, { anim: 'attack2', until: 0.85 }, { anim: 'fall', until: 1 }],
  flip:    [{ anim: 'jump', until: 0.6 }, { anim: 'fall', until: 1 }],
  hit:     [{ anim: 'takeHit', until: 1 }],
  death:   [{ anim: 'death', until: 1 }],
};

// Airborne moves have a fixed length (the jump sheets are only 2 frames long)
const MOVE_MS: Partial<Record<Move, number>> = { leap: 1000, flip: 700 };

function moveDuration(move: Move, char: CharDef): number {
  if (move === 'idle') return Infinity;
  if (MOVE_MS[move]) return MOVE_MS[move]!;
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
  if (r < 0.2) return 'leap';   // somersault strike — the long move, so keep it a treat
  if (r < 0.7) return 'attack2';
  return 'attack1';
}

// Keep chaining attacks while the game reported a hit this recently
const ATTACK_HOLD_MS = 300;

// ============ STAGE MOVEMENT ============
// x = how far a fighter has stepped from its starting spot toward the opponent (px).
const CONTACT_DIST = 170;   // centre-to-centre distance when trading blows (sword reach)
const IN_RANGE_PX = 60;     // close enough to the contact spot to start swinging
const RUN_SPEED = 560;      // px/s when closing in
const BACKSTEP_SPEED = 240; // px/s when backing off
const ENGAGE_MS = 1200;     // stay up close this long after the last landed hit
const KNOCKBACK_PX = 34;    // shove from taking a hit
const LEAP_HEIGHT = 120;
const FLIP_HEIGHT = 90;
const LEAP_IN_CHANCE = 0.5;   // close the gap with a somersault leap instead of running
const FLIP_OUT_CHANCE = 0.35; // back off with a backflip instead of stepping back

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (p: number) => p * p * (3 - 2 * p);

// ============ COMPONENT ============
const SpriteFighter: React.FC<FighterProps> = ({
  side, isAttacking, isDamaged, isGuarding = false, comboCount = 0, hp, maxHp, name, score,
}) => {
  const isLeft = side === 'left';
  const char = CHARACTERS[side];
  const hpPercent = maxHp > 0 ? (hp / maxHp) * 100 : 0;

  // dir: +1 = forward is to the right (P1), -1 = forward is to the left (P2)
  const dir = isLeft ? 1 : -1;

  // x/y/rot are screen offsets for the sprite: x along the floor, y height, rot somersault spin
  const [display, setDisplay] = useState<{ anim: AnimDef; frame: number; x: number; y: number; rot: number }>(
    () => ({ anim: char.anims.idle, frame: 0, x: 0, y: 0, rot: 0 })
  );
  const moveRef = useRef<Move>('idle');
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const comboRef = useRef<number>(comboCount);
  const guardRef = useRef<boolean>(isGuarding);
  const deadRef = useRef<boolean>(false);
  const prevDamage = useRef(false);

  // Stage movement (see STAGE MOVEMENT)
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const xRef = useRef(0);          // distance stepped toward the opponent
  const fromXRef = useRef(0);      // leap/flip start and end
  const toXRef = useRef(0);
  const kickRef = useRef(0);       // knockback, decays back to 0
  const reachRef = useRef(0);      // how far to step in to be in sword range
  const planRef = useRef<'run' | 'leap' | 'walk' | 'flip' | null>(null);  // how to close in / back off
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

  // Start a move. Leaps and flips travel from the current spot to toX.
  const begin = (m: Move, now: number, toX = xRef.current) => {
    moveRef.current = m; startRef.current = now;
    fromXRef.current = xRef.current; toXRef.current = toX;
  };
  const isAirborne = (m: Move) => m === 'leap' || m === 'flip';

  useEffect(() => {
    if (hp <= 0 && !deadRef.current) { deadRef.current = true; begin('death', performance.now()); }
    if (hp > 0 && deadRef.current) { deadRef.current = false; xRef.current = 0; begin('idle', performance.now()); }
  }, [hp]);

  // Attacks are started by the loop below (only once in sword range); hit reactions start here.
  useEffect(() => {
    if (deadRef.current) return;
    if (isDamaged && !prevDamage.current && moveRef.current !== 'hit') {
      kickRef.current = KNOCKBACK_PX;
      if (!isAirborne(moveRef.current)) begin('hit', performance.now());  // a hit reaction already playing finishes first
    }
    prevDamage.current = isDamaged;
  }, [isDamaged]);

  useEffect(() => {
    // Sword range depends on how far apart the two fighters stand, which depends on screen width.
    // Both fighters stand mirrored around the stage centre, so the gap is twice our distance to it.
    const measure = () => {
      const vp = viewportRef.current, stage = rootRef.current?.parentElement;
      if (!vp || !stage) return;
      const a = vp.getBoundingClientRect(), s = stage.getBoundingClientRect();
      const gap = 2 * Math.abs((s.left + s.width / 2) - (a.left + a.width / 2));
      reachRef.current = Math.max(0, gap - CONTACT_DIST);
    };
    measure();
    window.addEventListener('resize', measure);

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const dead = deadRef.current;
      const reach = reachRef.current;

      const dur = moveDuration(moveRef.current, char);
      let progress = dur === Infinity ? 0 : Math.min((now - startRef.current) / dur, 1);
      if (dur !== Infinity && progress >= 1 && moveRef.current !== 'death') {
        if (isAirborne(moveRef.current)) xRef.current = toXRef.current;
        begin('idle', now); progress = 0;
      }

      // Where to stand: up close while landing hits, back at the start otherwise
      const sinceHit = now - attackSignalAtRef.current;
      const landing = !dead && !guardRef.current && sinceHit < ATTACK_HOLD_MS;
      const engaged = !dead && !guardRef.current && sinceHit < ENGAGE_MS;
      const target = engaged ? reach : 0;
      const x = xRef.current;
      const inRange = Math.abs(reach - x) < IN_RANGE_PX;

      if (moveRef.current === 'idle' && !dead) {
        if (guardRef.current && x > IN_RANGE_PX) {
          // Our turn to defend while we're up in their face: backflip out
          planRef.current = null;
          begin('flip', now, 0);
        } else if (landing && inRange) {
          // Still landing hits up close: chain the next attack
          planRef.current = null;
          const m = pickMove(comboRef.current);
          begin(m, now, m === 'leap' ? reach : x);
        } else if (landing) {
          // Landing hits from across the stage: run in, or somersault in
          if (planRef.current !== 'run' && planRef.current !== 'leap') {
            planRef.current = Math.random() < LEAP_IN_CHANCE ? 'leap' : 'run';
          }
          if (planRef.current === 'leap') { planRef.current = null; begin('leap', now, reach); }
        } else if (!engaged && x > 150) {
          // Stopped landing hits: back off, sometimes with a backflip
          if (planRef.current !== 'walk' && planRef.current !== 'flip') {
            planRef.current = Math.random() < FLIP_OUT_CHANCE ? 'flip' : 'walk';
          }
          if (planRef.current === 'flip') { planRef.current = null; begin('flip', now, 0); }
        }
      }

      // Move along the floor
      const move = moveRef.current;
      let vx = 0, y = 0, rot = 0;
      if (isAirborne(move)) {
        const travel = smooth(progress);
        xRef.current = fromXRef.current + (toXRef.current - fromXRef.current) * travel;
        if (move === 'leap') {
          y = Math.sin(Math.PI * progress) * LEAP_HEIGHT;
          rot = dir * 360 * smooth(clamp01((progress - 0.05) / 0.4));      // forward somersault
        } else {
          y = Math.sin(Math.PI * progress) * FLIP_HEIGHT;
          rot = -dir * 360 * smooth(clamp01((progress - 0.05) / 0.75));    // backflip
        }
      } else if (!dead) {
        const gap = target - x;
        const speed = (gap > 0 ? RUN_SPEED : BACKSTEP_SPEED) * (move === 'idle' ? 1 : 0.3);  // drift only while swinging
        const step = Math.sign(gap) * Math.min(Math.abs(gap), speed * dt);
        xRef.current += step;
        vx = dt > 0 ? step / dt : 0;
      }
      kickRef.current *= Math.exp(-dt * 6);

      // Pick the frame: run while charging in, guard pose while defending, otherwise the move
      let frame: { anim: AnimDef; frame: number };
      if (move === 'idle' && vx > 40) {
        const run = char.anims.run;
        frame = { anim: run, frame: Math.floor((now / 1000) * run.fps) % run.frames };
      } else if (move === 'idle' && guardRef.current) {
        frame = { anim: char.anims[char.guard.anim], frame: char.guard.frame };
      } else {
        frame = getFrame(move, progress, char, now);
      }

      // Fighting-stance bounce when standing still
      const bob = move === 'idle' && Math.abs(vx) < 1 && !dead ? Math.sin((now / 1000) * Math.PI * 1.8) * 6 : 0;
      setDisplay({ ...frame, x: dir * (xRef.current - kickRef.current + bob), y, rot });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', measure); };
  }, [char, dir]);

  const inHit = moveRef.current === 'hit';
  const guardingNow = isGuarding && moveRef.current === 'idle' && !deadRef.current;
  const tier = tierOf(comboCount);
  const scaled = FRAME * char.scale;

  return (
    // The fighter doing the attacking is drawn in front when the two meet
    <div ref={rootRef} className="flex flex-col items-center relative" style={{ zIndex: isGuarding ? 1 : 2 }}>
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
      <div ref={viewportRef} className="relative" style={{ width: VIEW_W, height: VIEW_H, overflow: 'visible' }}>
        {/* floor shadow: follows the fighter along the floor, shrinks while they're in the air */}
        <div style={{
          position: 'absolute', bottom: 6, left: '50%',
          transform: `translateX(calc(-50% + ${display.x}px)) scale(${1 - Math.min(display.y / 250, 0.5)})`,
          width: 135, height: 22, borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 70%)',
        }} />
        {/* the fighter: steps, jumps and spins inside an untransformed viewport (used to measure the stage) */}
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${display.x}px, ${-display.y}px)` }}>
        <div style={{ position: 'absolute', inset: 0, transform: `rotate(${display.rot}deg)`, transformOrigin: '50% 62%' }}>
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
        </div>
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
    </div>
  );
};

export default SpriteFighter;
