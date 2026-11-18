// Synthesized sound effects via WebAudio. Pure code, no audio assets.
// Presentation layer only: must not be imported from client/src/game/**.

export type SfxName =
  | 'rifle'
  | 'cannon'
  | 'explosion'
  | 'build'
  | 'alarm'
  | 'fanfare'
  | 'defeat';

export interface Sfx {
  readonly enabled: boolean;
  masterVolume: number;
  setEnabled(on: boolean): void;
  play(name: SfxName): void;
  dispose(): void;
}

const RATE_LIMIT_MS = 50;

export function createSfx(): Sfx {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let enabled = true;
  let volume = 0.5;
  const lastPlay = new Map<SfxName, number>();

  function ensureCtx(): AudioContext | null {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    }
    const AC =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  // Create/resume the context on the first user gesture to satisfy
  // autoplay policies.
  const gesture = (): void => {
    ensureCtx();
  };
  window.addEventListener('pointerdown', gesture, { once: false });
  window.addEventListener('keydown', gesture, { once: false });

  function noiseBuffer(c: AudioContext, seconds: number, brown: boolean): AudioBuffer {
    const len = Math.max(1, Math.floor(c.sampleRate * seconds));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buf;
  }

  function env(c: AudioContext, t0: number, peak: number, decay: number): GainNode {
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
    return g;
  }

  function playNoise(
    c: AudioContext,
    opts: {
      dur: number;
      brown?: boolean;
      filter: 'lowpass' | 'highpass';
      freq: number;
      freqEnd?: number;
      peak: number;
    },
  ): void {
    const t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, opts.dur, opts.brown ?? false);
    const flt = c.createBiquadFilter();
    flt.type = opts.filter;
    flt.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd !== undefined) {
      flt.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);
    }
    const g = env(c, t0, opts.peak, opts.dur);
    src.connect(flt).connect(g).connect(master!);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  function playTone(
    c: AudioContext,
    opts: {
      type: OscillatorType;
      f0: number;
      f1?: number;
      t0offset?: number;
      dur: number;
      peak: number;
    },
  ): void {
    const t0 = c.currentTime + (opts.t0offset ?? 0);
    const osc = c.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1 !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(opts.f1, t0 + opts.dur);
    }
    const g = env(c, t0, opts.peak, opts.dur);
    osc.connect(g).connect(master!);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  const shots: Record<SfxName, (c: AudioContext) => void> = {
    // Short high-passed noise burst.
    rifle: (c) =>
      playNoise(c, { dur: 0.06, filter: 'highpass', freq: 1800, peak: 0.5 }),
    // Low-frequency sweep with a noise tail.
    cannon: (c) => {
      playTone(c, { type: 'triangle', f0: 160, f1: 40, dur: 0.25, peak: 0.7 });
      playNoise(c, {
        dur: 0.3,
        filter: 'lowpass',
        freq: 900,
        freqEnd: 200,
        peak: 0.35,
      });
    },
    // Brown noise through a sinking lowpass.
    explosion: (c) =>
      playNoise(c, {
        dur: 0.5,
        brown: true,
        filter: 'lowpass',
        freq: 1200,
        freqEnd: 150,
        peak: 0.8,
      }),
    // Two ascending square blips.
    build: (c) => {
      playTone(c, { type: 'square', f0: 440, dur: 0.08, peak: 0.25 });
      playTone(c, {
        type: 'square',
        f0: 660,
        t0offset: 0.09,
        dur: 0.12,
        peak: 0.25,
      });
    },
    // Two descending low-warning tones.
    alarm: (c) => {
      playTone(c, { type: 'sawtooth', f0: 520, f1: 380, dur: 0.22, peak: 0.3 });
      playTone(c, {
        type: 'sawtooth',
        f0: 520,
        f1: 380,
        t0offset: 0.3,
        dur: 0.22,
        peak: 0.3,
      });
    },
    // Short ascending major scale.
    fanfare: (c) => {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) =>
        playTone(c, {
          type: 'square',
          f0: f,
          t0offset: i * 0.12,
          dur: i === notes.length - 1 ? 0.35 : 0.11,
          peak: 0.3,
        }),
      );
    },
    // Short descending minor scale.
    defeat: (c) => {
      const notes = [440, 415, 349, 220];
      notes.forEach((f, i) =>
        playTone(c, {
          type: 'triangle',
          f0: f,
          t0offset: i * 0.18,
          dur: i === notes.length - 1 ? 0.5 : 0.17,
          peak: 0.3,
        }),
      );
    },
  };

  return {
    get enabled(): boolean {
      return enabled;
    },
    get masterVolume(): number {
      return volume;
    },
    set masterVolume(v: number) {
      volume = Math.min(1, Math.max(0, v));
      if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
    },
    setEnabled(on: boolean): void {
      enabled = on;
    },
    play(name: SfxName): void {
      if (!enabled) return;
      const now = performance.now();
      const last = lastPlay.get(name) ?? -Infinity;
      if (now - last < RATE_LIMIT_MS) return;
      lastPlay.set(name, now);
      const c = ensureCtx();
      if (!c || !master || c.state !== 'running') return;
      shots[name](c);
    },
    dispose(): void {
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      if (ctx) {
        void ctx.close();
        ctx = null;
        master = null;
      }
      lastPlay.clear();
    },
  };
}
