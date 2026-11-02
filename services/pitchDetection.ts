
/**
 * Pitch detection using Auto-Correlation
 */
export function autoCorrelate(buffer: Float32Array, sampleRate: number): number {
  let size = buffer.length;
  let rms = 0;

  for (let i = 0; i < size; i++) {
    let val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return -1; // Not enough signal

  let r1 = 0, r2 = size - 1, thres = 0.2;
  for (let i = 0; i < size / 2; i++) {
    if (Math.abs(buffer[i]) < thres) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < size / 2; i++) {
    if (Math.abs(buffer[size - i]) < thres) {
      r2 = size - i;
      break;
    }
  }

  const buf = buffer.slice(r1, r2);
  const bufSize = buf.length;

  const c = new Array(bufSize).fill(0);
  for (let i = 0; i < bufSize; i++) {
    for (let j = 0; j < bufSize - i; j++) {
      c[i] = c[i] + buf[j] * buf[j + i];
    }
  }

  let d = 0;
  while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < bufSize; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }

  let T0 = maxpos;
  return sampleRate / T0;
}

/**
 * YIN pitch detection (de Cheveigné & Kawahara, 2002), tuned for singing.
 * Robust against octave errors, only reports pitches in the human singing range,
 * and returns -1 when the sound isn't clearly pitched (breath, noise, silence).
 * Works on a 2048-sample frame; downsamples to ~24 kHz first to keep it cheap on phones.
 */
const VOICE_MIN_HZ = 65;      // C2
const VOICE_MAX_HZ = 1100;    // ~C#6
const YIN_THRESHOLD = 0.15;   // lower = stricter about "is this a clear note?"
const SILENCE_RMS = 0.01;

export interface PitchResult { pitch: number; clarity: number; rms: number }

export function detectPitch(input: Float32Array, sampleRate: number): PitchResult {
  let rms = 0;
  for (let i = 0; i < input.length; i++) rms += input[i] * input[i];
  rms = Math.sqrt(rms / input.length);
  if (rms < SILENCE_RMS) return { pitch: -1, clarity: 0, rms };

  // Downsample by 2 (pairwise average) when the rate is high: 4x less work.
  let x: Float32Array = input;
  let sr = sampleRate;
  if (sampleRate >= 32000) {
    x = new Float32Array(input.length >> 1);
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * (input[2 * i] + input[2 * i + 1]);
    sr = sampleRate / 2;
  }

  const minLag = Math.max(2, Math.floor(sr / VOICE_MAX_HZ));
  const maxLag = Math.min(Math.floor(sr / VOICE_MIN_HZ), Math.floor(x.length / 2));
  const W = x.length - maxLag;
  const d = new Float32Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = x[j] - x[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // cumulative mean normalized difference
  const cmnd = new Float32Array(maxLag + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  // first dip below the threshold (then walk to its bottom); else the global minimum
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return { pitch: -1, clarity: 0, rms };   // no clear note
  // parabolic interpolation for sub-sample accuracy
  const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? 0.5 * (a - c) / denom : 0;
  const pitch = sr / (tau + (Math.abs(shift) < 1 ? shift : 0));
  if (pitch < VOICE_MIN_HZ || pitch > VOICE_MAX_HZ) return { pitch: -1, clarity: 0, rms };
  return { pitch, clarity: 1 - b, rms };
}

/**
 * Frequency to MIDI note number (optional for visualization)
 */
export function freqToNote(frequency: number): number {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
}

/**
 * Frequency to Name
 */
export function freqToName(frequency: number): string {
  const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteNum = freqToNote(frequency);
  return noteStrings[noteNum % 12];
}
