// Synthesized sound effects via WebAudio. Pure code, no audio assets.
// Presentation layer only: must not be imported from client/src/game/**.
// Safe to import and call in a DOM-less environment: every entry point
// silently no-ops when no AudioContext can be created.

export type SfxName =
  | 'rifle'
  | 'cannon'
  | 'explosion'
  | 'build'
  | 'alarm'
  | 'fanfare'
  | 'defeat'
  | 'buildStart'
  | 'buildComplete'
  | 'harvestUnload'
  | 'promote'
  | 'lowPower'
  | 'baseAttack';

/** Unit kinds that can bark back; kept local so audio stays game-free. */
export type UnitVoice = 'infantry' | 'tank' | 'harvester' | 'turret';

/** Mixer groups: UI feedback, weapons/explosions, unit voice barks. */
export type SfxGroup = 'ui' | 'combat' | 'voice';

export interface Sfx {
  readonly enabled: boolean;
  masterVolume: number;
  setEnabled(on: boolean): void;
  /**
   * Play a named effect. `opts.gain` (0..1) scales loudness for
   * off-screen/distance attenuation; omit for full volume.
   */
  play(name: SfxName, opts?: { gain?: number }): void;
  /** Selection acknowledgment bark for a unit kind. */
  unitAck(kind: UnitVoice): void;
  /** Order confirmation bark for a unit kind. */
  unitOrder(kind: UnitVoice): void;
  /** Death bark for a unit kind. */
  unitDeath(kind: UnitVoice): void;
  /** Per-group volume, 0..1, applied on top of masterVolume. */
  setGroupVolume(group: SfxGroup, v: number): void;
  dispose(): void;
}

const RATE_LIMIT_MS = 80;
const VOICE_RATE_LIMIT_MS = 90;
const GROUPS: readonly SfxGroup[] = ['ui', 'combat', 'voice'];
const hasWindow = typeof window !== 'undefined';

export function createSfx(): Sfx {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let enabled = true;
  let volume = 0.5;
  const groupVol: Record<SfxGroup, number> = { ui: 1, combat: 1, voice: 1 };
  const buses = {} as Record<SfxGroup, GainNode>;
  const lastPlay = new Map<string, number>();

  function ensureCtx(): AudioContext | null {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    }
    if (!hasWindow) return null;
    const AC =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    for (const g of GROUPS) {
      const bus = ctx.createGain();
      bus.gain.value = groupVol[g];
      bus.connect(master);
      buses[g] = bus;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  // Create/resume the context on the first user gesture to satisfy
  // autoplay policies.
  const gesture = (): void => {
    ensureCtx();
  };
  if (hasWindow) {
    window.addEventListener('pointerdown', gesture, { once: false });
    window.addEventListener('keydown', gesture, { once: false });
  }

  /** Context only when it can actually emit sound this frame. */
  function readyCtx(): AudioContext | null {
    const c = ensureCtx();
    if (!c || !master || c.state !== 'running') return null;
    return c;
  }

  function rateOk(key: string, ms: number): boolean {
    const now = performance.now();
    const last = lastPlay.get(key) ?? -Infinity;
    if (now - last < ms) return false;
    lastPlay.set(key, now);
    return true;
  }

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
    bus: AudioNode,
    opts: {
      dur: number;
      brown?: boolean;
      filter: 'lowpass' | 'highpass' | 'bandpass';
      freq: number;
      freqEnd?: number;
      q?: number;
      peak: number;
      t0offset?: number;
    },
  ): void {
    const t0 = c.currentTime + (opts.t0offset ?? 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, opts.dur, opts.brown ?? false);
    const flt = c.createBiquadFilter();
    flt.type = opts.filter;
    flt.frequency.setValueAtTime(opts.freq, t0);
    if (opts.q !== undefined) flt.Q.value = opts.q;
    if (opts.freqEnd !== undefined) {
      flt.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);
    }
    const g = env(c, t0, opts.peak, opts.dur);
    src.connect(flt).connect(g).connect(bus);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  function playTone(
    c: AudioContext,
    bus: AudioNode,
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
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  const shots: Record<
    SfxName,
    { group: SfxGroup; fn: (c: AudioContext, bus: AudioNode) => void }
  > = {
    // Short high-passed noise burst.
    rifle: {
      group: 'combat',
      fn: (c, bus) =>
        playNoise(c, bus, { dur: 0.06, filter: 'highpass', freq: 1800, peak: 0.5 }),
    },
    // Low-frequency sweep with a noise tail.
    cannon: {
      group: 'combat',
      fn: (c, bus) => {
        playTone(c, bus, { type: 'triangle', f0: 160, f1: 40, dur: 0.25, peak: 0.7 });
        playNoise(c, bus, {
          dur: 0.3,
          filter: 'lowpass',
          freq: 900,
          freqEnd: 200,
          peak: 0.35,
        });
      },
    },
    // Brown noise through a sinking lowpass.
    explosion: {
      group: 'combat',
      fn: (c, bus) =>
        playNoise(c, bus, {
          dur: 0.5,
          brown: true,
          filter: 'lowpass',
          freq: 1200,
          freqEnd: 150,
          peak: 0.8,
        }),
    },
    // Two ascending square blips.
    build: {
      group: 'ui',
      fn: (c, bus) => {
        playTone(c, bus, { type: 'square', f0: 440, dur: 0.08, peak: 0.25 });
        playTone(c, bus, {
          type: 'square',
          f0: 660,
          t0offset: 0.09,
          dur: 0.12,
          peak: 0.25,
        });
      },
    },
    // Two descending low-warning tones.
    alarm: {
      group: 'ui',
      fn: (c, bus) => {
        playTone(c, bus, { type: 'sawtooth', f0: 520, f1: 380, dur: 0.22, peak: 0.3 });
        playTone(c, bus, {
          type: 'sawtooth',
          f0: 520,
          f1: 380,
          t0offset: 0.3,
          dur: 0.22,
          peak: 0.3,
        });
      },
    },
    // Short ascending major scale.
    fanfare: {
      group: 'ui',
      fn: (c, bus) => {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) =>
          playTone(c, bus, {
            type: 'square',
            f0: f,
            t0offset: i * 0.12,
            dur: i === notes.length - 1 ? 0.35 : 0.11,
            peak: 0.3,
          }),
        );
      },
    },
    // Short descending minor scale.
    defeat: {
      group: 'ui',
      fn: (c, bus) => {
        const notes = [440, 415, 349, 220];
        notes.forEach((f, i) =>
          playTone(c, bus, {
            type: 'triangle',
            f0: f,
            t0offset: i * 0.18,
            dur: i === notes.length - 1 ? 0.5 : 0.17,
            peak: 0.3,
          }),
        );
      },
    },
    // Clank + rising blip when construction starts.
    buildStart: {
      group: 'ui',
      fn: (c, bus) => {
        playNoise(c, bus, {
          dur: 0.05,
          filter: 'bandpass',
          freq: 900,
          q: 1.5,
          peak: 0.3,
        });
        playTone(c, bus, {
          type: 'square',
          f0: 240,
          f1: 320,
          t0offset: 0.04,
          dur: 0.09,
          peak: 0.25,
        });
      },
    },
    // Three-note rising chime when construction finishes.
    buildComplete: {
      group: 'ui',
      fn: (c, bus) => {
        const notes = [660, 880, 990];
        notes.forEach((f, i) =>
          playTone(c, bus, {
            type: 'triangle',
            f0: f,
            t0offset: i * 0.09,
            dur: i === notes.length - 1 ? 0.22 : 0.09,
            peak: 0.3,
          }),
        );
      },
    },
    // Conveyor rumble + clunk for a harvester dumping ore.
    harvestUnload: {
      group: 'ui',
      fn: (c, bus) => {
        playNoise(c, bus, {
          dur: 0.35,
          brown: true,
          filter: 'lowpass',
          freq: 500,
          freqEnd: 140,
          peak: 0.3,
        });
        playTone(c, bus, { type: 'triangle', f0: 220, f1: 140, dur: 0.3, peak: 0.3 });
        playNoise(c, bus, {
          dur: 0.05,
          filter: 'bandpass',
          freq: 1100,
          q: 1.5,
          t0offset: 0.3,
          peak: 0.25,
        });
      },
    },
    // Bright triple chirp for a veteran promotion.
    promote: {
      group: 'ui',
      fn: (c, bus) => {
        const notes = [880, 1108, 1318];
        notes.forEach((f, i) =>
          playTone(c, bus, {
            type: 'square',
            f0: f,
            t0offset: i * 0.07,
            dur: i === notes.length - 1 ? 0.16 : 0.06,
            peak: 0.22,
          }),
        );
      },
    },
    // Dull low warble — power below demand.
    lowPower: {
      group: 'ui',
      fn: (c, bus) => {
        playTone(c, bus, { type: 'square', f0: 180, f1: 140, dur: 0.25, peak: 0.3 });
        playTone(c, bus, {
          type: 'square',
          f0: 160,
          f1: 120,
          t0offset: 0.32,
          dur: 0.3,
          peak: 0.3,
        });
      },
    },
    // Urgent two-tone siren while the base takes damage.
    baseAttack: {
      group: 'ui',
      fn: (c, bus) => {
        for (let i = 0; i < 3; i++) {
          playTone(c, bus, {
            type: 'sawtooth',
            f0: i % 2 === 0 ? 620 : 880,
            f1: i % 2 === 0 ? 880 : 620,
            t0offset: i * 0.22,
            dur: 0.2,
            peak: 0.32,
          });
        }
      },
    },
  };

  // --- Unit voice barks -----------------------------------------------------
  // All are short radio-style chirps: a static click plus one or two
  // pitched blips. Infantry is thin and quick, vehicles are lower and
  // chunkier; deaths are little falls with a noise tail.

  type VoiceFn = (c: AudioContext, bus: AudioNode) => void;

  const acks: Record<UnitVoice, VoiceFn> = {
    // Radio click + single blip — "roger".
    infantry: (c, bus) => {
      playNoise(c, bus, { dur: 0.025, filter: 'bandpass', freq: 2800, q: 2, peak: 0.18 });
      playTone(c, bus, { type: 'square', f0: 880, t0offset: 0.03, dur: 0.05, peak: 0.2 });
    },
    // Gruff low blip + click.
    tank: (c, bus) => {
      playTone(c, bus, { type: 'square', f0: 200, dur: 0.07, peak: 0.3 });
      playNoise(c, bus, { dur: 0.02, filter: 'bandpass', freq: 1500, q: 2, peak: 0.15 });
    },
    // Utility chirp rising.
    harvester: (c, bus) =>
      playTone(c, bus, { type: 'triangle', f0: 480, f1: 840, dur: 0.11, peak: 0.25 }),
    // Servo blip.
    turret: (c, bus) =>
      playTone(c, bus, { type: 'square', f0: 660, f1: 990, dur: 0.05, peak: 0.2 }),
  };

  const orderFx: Record<UnitVoice, VoiceFn> = {
    // Two quick rising blips — "moving out".
    infantry: (c, bus) => {
      playTone(c, bus, { type: 'square', f0: 740, dur: 0.05, peak: 0.22 });
      playTone(c, bus, { type: 'square', f0: 980, t0offset: 0.07, dur: 0.06, peak: 0.22 });
    },
    // Low double thump.
    tank: (c, bus) => {
      playTone(c, bus, { type: 'triangle', f0: 150, dur: 0.09, peak: 0.3 });
      playTone(c, bus, { type: 'triangle', f0: 120, t0offset: 0.1, dur: 0.1, peak: 0.3 });
    },
    // Two-tone confirm.
    harvester: (c, bus) => {
      playTone(c, bus, { type: 'triangle', f0: 560, dur: 0.06, peak: 0.25 });
      playTone(c, bus, { type: 'triangle', f0: 840, t0offset: 0.08, dur: 0.08, peak: 0.25 });
    },
    // Single servo sweep.
    turret: (c, bus) =>
      playTone(c, bus, { type: 'square', f0: 520, f1: 780, dur: 0.07, peak: 0.2 }),
  };

  const deaths: Record<UnitVoice, VoiceFn> = {
    // Thin scream + static tail.
    infantry: (c, bus) => {
      playTone(c, bus, { type: 'sawtooth', f0: 620, f1: 160, dur: 0.28, peak: 0.3 });
      playNoise(c, bus, { dur: 0.08, filter: 'highpass', freq: 3000, peak: 0.15 });
    },
    // Metallic crunch.
    tank: (c, bus) => {
      playTone(c, bus, { type: 'square', f0: 240, f1: 55, dur: 0.3, peak: 0.4 });
      playNoise(c, bus, {
        dur: 0.35,
        brown: true,
        filter: 'lowpass',
        freq: 800,
        freqEnd: 120,
        peak: 0.35,
      });
    },
    // Heavy sinking rumble.
    harvester: (c, bus) => {
      playTone(c, bus, { type: 'triangle', f0: 320, f1: 70, dur: 0.4, peak: 0.35 });
      playNoise(c, bus, {
        dur: 0.45,
        brown: true,
        filter: 'lowpass',
        freq: 600,
        freqEnd: 100,
        peak: 0.4,
      });
    },
    // Turret crash.
    turret: (c, bus) => {
      playTone(c, bus, { type: 'square', f0: 300, f1: 50, dur: 0.25, peak: 0.35 });
      playNoise(c, bus, {
        dur: 0.3,
        filter: 'lowpass',
        freq: 1000,
        freqEnd: 150,
        peak: 0.35,
      });
    },
  };

  function playVoice(
    kind: UnitVoice,
    tag: string,
    table: Record<UnitVoice, VoiceFn>,
  ): void {
    if (!enabled) return;
    if (!rateOk(`${tag}:${kind}`, VOICE_RATE_LIMIT_MS)) return;
    const c = readyCtx();
    if (c) table[kind](c, buses.voice ?? master!);
  }

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
    play(name: SfxName, opts?: { gain?: number }): void {
      if (!enabled) return;
      if (!rateOk(name, RATE_LIMIT_MS)) return;
      const c = readyCtx();
      if (!c) return;
      const s = shots[name];
      let bus: AudioNode = buses[s.group] ?? master!;
      // Distance/off-screen attenuation: a throwaway gain staged before
      // the group bus so group/master volumes still apply on top.
      if (opts?.gain !== undefined) {
        const g = c.createGain();
        g.gain.value = Math.min(1, Math.max(0, opts.gain));
        g.connect(bus);
        bus = g;
      }
      s.fn(c, bus);
    },
    unitAck(kind: UnitVoice): void {
      playVoice(kind, 'ack', acks);
    },
    unitOrder(kind: UnitVoice): void {
      playVoice(kind, 'order', orderFx);
    },
    unitDeath(kind: UnitVoice): void {
      playVoice(kind, 'death', deaths);
    },
    setGroupVolume(group: SfxGroup, v: number): void {
      const x = Math.min(1, Math.max(0, v));
      groupVol[group] = x;
      const bus = buses[group];
      if (bus && ctx) bus.gain.setTargetAtTime(x, ctx.currentTime, 0.02);
    },
    dispose(): void {
      if (hasWindow) {
        window.removeEventListener('pointerdown', gesture);
        window.removeEventListener('keydown', gesture);
      }
      if (ctx) {
        void ctx.close();
        ctx = null;
        master = null;
      }
      lastPlay.clear();
    },
  };
}
