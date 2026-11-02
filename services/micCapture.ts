/**
 * Microphone capture that keeps running when the page is in the background.
 *
 * The old loop used requestAnimationFrame, which browsers pause for background tabs,
 * minimised windows and locked phones — so a player page that wasn't in front sent
 * no pitch at all. Audio processing callbacks (AudioWorklet, or ScriptProcessor as a
 * fallback) are driven by the audio clock instead and keep firing.
 *
 * onFrame receives the latest FRAME_SIZE samples every HOP_SIZE samples
 * (~43 ms window, ~21 ms apart at 48 kHz).
 */
export const FRAME_SIZE = 2048;
export const HOP_SIZE = 1024;

export interface MicCapture {
  audioContext: AudioContext;
  sampleRate: number;
  stop: () => void;
}

// Runs on the audio thread: just collects samples and hands frames to the page.
const WORKLET_SOURCE = `
class FrameCollector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(${FRAME_SIZE});
    this.filled = 0;
    this.sinceLast = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      const n = input.length;
      if (n >= ${FRAME_SIZE}) { this.buf.set(input.subarray(n - ${FRAME_SIZE})); this.filled = ${FRAME_SIZE}; }
      else { this.buf.copyWithin(0, n); this.buf.set(input, ${FRAME_SIZE} - n); this.filled = Math.min(${FRAME_SIZE}, this.filled + n); }
      this.sinceLast += n;
      if (this.filled === ${FRAME_SIZE} && this.sinceLast >= ${HOP_SIZE}) {
        this.sinceLast = 0;
        const frame = this.buf.slice();
        this.port.postMessage(frame, [frame.buffer]);
      }
    }
    const out = outputs[0] && outputs[0][0];
    if (out) out.fill(0);   // stay silent
    return true;
  }
}
registerProcessor('frame-collector', FrameCollector);
`;

export async function startMicCapture(
  stream: MediaStream,
  onFrame: (frame: Float32Array, sampleRate: number) => void,
): Promise<MicCapture> {
  const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AudioContextClass();
  if (ctx.state === 'suspended') await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const mute = ctx.createGain();
  mute.gain.value = 0;              // processing nodes must reach the speakers to run; keep them silent
  mute.connect(ctx.destination);

  let node: AudioNode | null = null;
  let cleanup: () => void = () => {};

  if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
      const worklet = new AudioWorkletNode(ctx, 'frame-collector', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data, ctx.sampleRate);
      node = worklet;
      cleanup = () => { worklet.port.onmessage = null; };
    } catch (err) {
      console.warn('[Mic] AudioWorklet unavailable, using ScriptProcessor instead:', err);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (!node) {
    // Older browsers: ScriptProcessor (deprecated, but also audio-clock driven)
    const proc = ctx.createScriptProcessor(HOP_SIZE, 1, 1);
    const buf = new Float32Array(FRAME_SIZE);
    proc.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);
      buf.copyWithin(0, input.length);
      buf.set(input, FRAME_SIZE - input.length);
      onFrame(buf.slice(), ctx.sampleRate);
    };
    node = proc;
    cleanup = () => { proc.onaudioprocess = null; };
  }

  source.connect(node);
  node.connect(mute);

  // Some browsers suspend audio when a page is hidden; resume when it comes back.
  const onVisible = () => { if (document.visibilityState === 'visible' && ctx.state === 'suspended') ctx.resume(); };
  document.addEventListener('visibilitychange', onVisible);

  return {
    audioContext: ctx,
    sampleRate: ctx.sampleRate,
    stop: () => {
      document.removeEventListener('visibilitychange', onVisible);
      cleanup();
      try { source.disconnect(); node!.disconnect(); mute.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach(t => t.stop());
      ctx.close().catch(() => {});
    },
  };
}
