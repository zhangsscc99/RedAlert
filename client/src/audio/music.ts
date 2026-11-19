// Procedurally synthesized looping BGM via WebAudio. No audio assets.
// Presentation layer only: must not be imported from client/src/game/**.
// The AudioContext is injected by the caller; nothing touches the DOM here.

import {
  defaultAudioStorage,
  loadAudioState,
  saveAudioState,
  type AudioStorageLike,
} from './sfx.js';

export type MusicTrack = 'menu' | 'battle';

export interface NoteEvent {
  /** Beat offset within the loop. */
  beat: number;
  /** MIDI note number. */
  midi: number;
  /** Length in beats. */
  beats: number;
  /** 0..1 velocity, scales the note envelope peak. */
  vel: number;
}

export interface PercEvent {
  beat: number;
  /** Bandpass center frequency shaping the noise hit. */
  freq: number;
  /** Noise burst length in seconds. */
  dur: number;
  vel: number;
}

export interface VoicePart {
  wave: OscillatorType;
  /** Part gain relative to track master, 0..1. */
  gain: number;
  /** Envelope attack seconds. */
  attack: number;
  /** Detune in cents applied to every oscillator (rout-layer drift). */
  detune?: number;
  notes: NoteEvent[];
}

/**
 * Adaptive arrangement stems blended by combat intensity. 'base' stems
 * always play at full weight; 'calm'/'combat'/'rout' fade with intensity.
 */
export type MusicLayer = 'base' | 'calm' | 'combat' | 'rout' | 'defeat';

export interface LayerDef {
  layer: MusicLayer;
  /** Optional lowpass cutoff (Hz) muffling the whole stem. */
  lpFreq?: number;
  parts: VoicePart[];
  perc: PercEvent[];
}

export interface TrackDef {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  parts: VoicePart[];
  perc: PercEvent[];
  /** Adaptive stems; when absent, parts/perc play as an always-on stem. */
  layers?: LayerDef[];
}

export interface Music {
  play(track: MusicTrack): void;
  stop(): void;
  /** Music bus level 0..1; the master bus level multiplies on top. */
  setVolume(v: number): void;
  readonly volume: number;
  /** Master bus level 0..1, shared with the sfx mixer — persisted. */
  setMasterVolume(v: number): void;
  readonly masterVolume: number;
  readonly muted: boolean;
  /**
   * Switch tracks with an equal-power-style crossfade; `seconds` is
   * clamped into the 0.3–0.6s scene-transition window.
   */
  crossfade(track: MusicTrack, seconds: number): void;
  /**
   * Combat intensity 0..1, fed per-frame; rebalances stems in place.
   * `opts.fadeScale` multiplies the per-layer fade times (0.8–1.5s base).
   */
  setIntensity?(v: number, opts?: { fadeScale?: number }): void;
  /** Silence the bus without losing the stored volume. */
  setMuted?(muted: boolean): void;
  dispose(): void;
}

const MAX_VOLUME = 0.35;

/** MIDI note number to frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

/** Loop length in seconds for a track definition or name. */
export function trackDuration(track: MusicTrack | TrackDef): number {
  const def = typeof track === 'string' ? TRACKS[track] : track;
  return (def.bars * def.beatsPerBar * 60) / def.bpm;
}

function smooth01(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Stem weights for combat intensity 0..1: 'calm' owns the low end,
 * 'combat' the middle, 'rout' the top end. Exported for tuning/tests.
 */
export function layerWeights(
  intensity: number,
): Record<'calm' | 'combat' | 'rout', number> {
  const x = Math.min(1, Math.max(0, intensity));
  return {
    calm: 1 - smooth01(0.25, 0.55, x),
    combat: smooth01(0.2, 0.45, x) * (1 - smooth01(0.75, 0.95, x)),
    rout: smooth01(0.7, 0.95, x),
  };
}

function layerWeight(name: MusicLayer, intensity: number): number {
  if (name === 'base') return 1;
  const w = layerWeights(intensity);
  // 'defeat' is an alias for the rout arrangement.
  return name === 'defeat' ? w.rout : w[name];
}

/**
 * Per-stem fade seconds for intensity rebalances: slow enough to read as
 * layered crossfades (0.8–1.5s) rather than a hard cut. The defeat/rout
 * pad swells slowest so the collapse feels gradual.
 */
const LAYER_FADE_SEC: Record<MusicLayer, number> = {
  base: 0.8,
  calm: 1.0,
  combat: 0.8,
  rout: 1.5,
  defeat: 1.5,
};

// --- Pure data tables -------------------------------------------------------

// Sustained pad chord per bar: each chord lasts a full bar.
function padPart(chords: number[][], gain: number): VoicePart {
  const notes: NoteEvent[] = [];
  chords.forEach((chord, bar) => {
    for (const midi of chord) {
      notes.push({ beat: bar * 4, midi, beats: 4, vel: 0.7 });
    }
  });
  return { wave: 'sawtooth', gain, attack: 0.9, notes };
}

// Sparse arpeggio: deterministic 8th-note pattern over each chord, only on
// odd-numbered bars so the texture stays airy.
function arpPart(chords: number[][], gain: number): VoicePart {
  const notes: NoteEvent[] = [];
  const pattern = [0, 2, 1, 3];
  chords.forEach((chord, bar) => {
    if (bar % 2 === 0) return;
    for (let i = 0; i < 8; i++) {
      const tone = chord[pattern[i % pattern.length] % chord.length];
      notes.push({
        beat: bar * 4 + i * 0.5,
        midi: tone + 12,
        beats: 0.5,
        vel: 0.25 + 0.15 * (i % 2),
      });
    }
  });
  return { wave: 'triangle', gain, attack: 0.01, notes };
}

// Eighth-note bass ostinato: root on beats, fifth/octave pickups off-beats.
function bassPart(roots: number[], gain: number): VoicePart {
  const notes: NoteEvent[] = [];
  roots.forEach((root, bar) => {
    for (let i = 0; i < 8; i++) {
      const midi =
        i === 6 ? root + 7 : i % 2 === 0 ? root : root + (i === 7 ? 12 : 0);
      notes.push({
        beat: bar * 4 + i * 0.5,
        midi,
        beats: 0.45,
        vel: i % 2 === 0 ? 0.8 : 0.55,
      });
    }
  });
  return { wave: 'square', gain, attack: 0.005, notes };
}

// Lead motif played over the second half of the loop.
function leadPart(motif: [number, number, number][], startBar: number, gain: number): VoicePart {
  const notes: NoteEvent[] = motif.map(([off, midi, beats]) => ({
    beat: startBar * 4 + off,
    midi,
    beats,
    vel: 0.6,
  }));
  return { wave: 'sawtooth', gain, attack: 0.03, notes };
}

// Percussion: kicks (low freq, longer body) on quarter notes, hats (high,
// short) on off-beats, snare on 2 & 4.
function percTrack(bars: number): PercEvent[] {
  const evs: PercEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let b = 0; b < 4; b++) {
      evs.push({ beat: bar * 4 + b, freq: 120, dur: 0.12, vel: 0.9 });
      evs.push({ beat: bar * 4 + b + 0.5, freq: 6000, dur: 0.04, vel: 0.3 });
      if (b === 1 || b === 3) {
        evs.push({ beat: bar * 4 + b, freq: 1800, dur: 0.09, vel: 0.5 });
      }
    }
  }
  return evs;
}

// Driving 16th-note ostinato faded in at combat intensity; the flat-2
// pickup keeps the Phrygian edge of the battle motif.
function sixteenthPart(roots: number[], gain: number): VoicePart {
  const notes: NoteEvent[] = [];
  const pattern = [0, 7, 0, 12, 0, 7, 1, 7];
  roots.forEach((root, bar) => {
    for (let i = 0; i < 16; i++) {
      notes.push({
        beat: bar * 4 + i * 0.25,
        midi: root + 12 + pattern[i % pattern.length],
        beats: 0.2,
        vel: i % 4 === 0 ? 0.6 : 0.35,
      });
    }
  });
  return { wave: 'square', gain, attack: 0.004, notes };
}

// Rout pad: each chord held for two bars under a slow attack so the whole
// arrangement reads as slowed down; per-part detune drifts it sour.
function routPadPart(chords: number[][], detune: number, gain: number): VoicePart {
  const notes: NoteEvent[] = [];
  for (let bar = 0; bar < chords.length; bar += 2) {
    for (const midi of chords[bar]) {
      notes.push({ beat: bar * 4, midi: midi + 12, beats: 8, vel: 0.5 });
    }
  }
  return { wave: 'sawtooth', gain, attack: 1.8, detune, notes };
}

// Sustained low root per bar: the bass bed under calm and defeat stems
// where the busy 8th-note ostinato would be too aggressive.
function bedBassPart(
  roots: number[],
  gain: number,
  wave: OscillatorType = 'triangle',
): VoicePart {
  return {
    wave,
    gain,
    attack: 0.4,
    notes: roots.map((root, bar) => ({
      beat: bar * 4,
      midi: root + 12,
      beats: 3.8,
      vel: 0.6,
    })),
  };
}

// Off-beat hats only: keeps the calm stem breathing without a backbeat.
function hatTrack(bars: number, vel: number): PercEvent[] {
  const evs: PercEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let b = 0; b < 4; b++) {
      evs.push({ beat: bar * 4 + b + 0.5, freq: 7000, dur: 0.05, vel });
    }
  }
  return evs;
}

// Half-time pulse under defeat: kick on 1, dull rim on 3.
function defeatPerc(bars: number): PercEvent[] {
  const evs: PercEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    evs.push({ beat: bar * 4, freq: 100, dur: 0.16, vel: 0.7 });
    evs.push({ beat: bar * 4 + 2, freq: 900, dur: 0.08, vel: 0.3 });
  }
  return evs;
}

// Slow sub pulse under the rout pad: one swollen root note per bar.
function routPulsePart(roots: number[], gain: number): VoicePart {
  return {
    wave: 'sine',
    gain,
    attack: 0.5,
    detune: -12,
    notes: roots.map((root, bar) => ({
      beat: bar * 4,
      midi: root,
      beats: 3,
      vel: 0.55,
    })),
  };
}

// Am - F - C - G, two bars each: menu pad is calm and unresolved.
const MENU_CHORDS: number[][] = [
  [45, 52, 57, 60], // A2 E3 A3 C4
  [45, 52, 57, 60],
  [41, 48, 53, 57], // F2 C3 F3 A3
  [41, 48, 53, 57],
  [36, 48, 52, 55], // C2 C3 E3 G3
  [36, 48, 52, 55],
  [43, 50, 55, 59], // G2 D3 G3 B3
  [43, 50, 55, 59],
];

// E - E - G - A pedal-point roots under a Phrygian-flavored motif.
const BATTLE_ROOTS = [28, 28, 28, 28, 31, 31, 33, 33]; // E1..A1

// Low three-note beds matching the battle roots: Em, G, A. Calm pads sit
// right on the roots; rout pads re-voice them an octave up (see routPadPart).
const BATTLE_BED: number[][] = [
  [28, 40, 47], // E1 E2 B2
  [28, 40, 47],
  [28, 40, 47],
  [28, 40, 47],
  [31, 43, 50], // G1 G2 D3
  [31, 43, 50],
  [33, 45, 52], // A1 A2 E3
  [33, 45, 52],
];

const BATTLE_MOTIF: [number, number, number][] = [
  [0, 64, 0.5], // E4
  [0.5, 64, 0.5],
  [1, 67, 0.5], // G4
  [1.5, 64, 1],
  [2.5, 65, 0.5], // F4 (b2 tension)
  [3, 64, 1],
  [4, 64, 0.5],
  [4.5, 62, 0.5], // D4
  [5, 64, 1],
  [6, 59, 0.5], // B3
  [6.5, 60, 0.5], // C4
  [7, 62, 1],
];

export const TRACKS: Record<MusicTrack, TrackDef> = {
  menu: {
    bpm: 72,
    beatsPerBar: 4,
    bars: 8,
    parts: [padPart(MENU_CHORDS, 0.5), arpPart(MENU_CHORDS, 0.5)],
    perc: [],
  },
  battle: {
    bpm: 132,
    beatsPerBar: 4,
    bars: 8,
    parts: [],
    perc: [],
    // Three adaptive stems on one shared loop clock, crossfaded in place
    // by combat intensity — the graph is never rebuilt mid-fight.
    layers: [
      {
        layer: 'calm',
        parts: [
          bedBassPart(BATTLE_ROOTS, 0.4),
          padPart(BATTLE_BED, 0.45),
          arpPart(BATTLE_BED, 0.35),
        ],
        perc: hatTrack(8, 0.18),
      },
      {
        layer: 'combat',
        parts: [
          bassPart(BATTLE_ROOTS, 0.5),
          sixteenthPart(BATTLE_ROOTS, 0.28),
          leadPart(BATTLE_MOTIF, 4, 0.4),
        ],
        perc: percTrack(8),
      },
      {
        layer: 'defeat',
        lpFreq: 750,
        parts: [
          routPulsePart(BATTLE_ROOTS, 0.3),
          routPadPart(BATTLE_BED, -28, 0.42),
          routPadPart(BATTLE_BED, 22, 0.34),
          arpPart(BATTLE_BED, 0.2),
        ],
        perc: defeatPerc(8),
      },
    ],
  },
};

// --- Seeded noise -----------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Engine -----------------------------------------------------------------

const LOOKAHEAD_SEC = 0.25;
const TICK_MS = 60;
/** Scene-switch crossfade window: 300–600ms. */
const CROSSFADE_MIN_SEC = 0.3;
const CROSSFADE_MAX_SEC = 0.6;

/** Optional injection: persistent mixer storage shared with the sfx bus. */
export interface MusicOptions {
  storage?: AudioStorageLike;
}

export function createMusic(ac: AudioContext, options: MusicOptions = {}): Music {
  const storage =
    options.storage !== undefined ? options.storage : defaultAudioStorage();
  const persisted = loadAudioState(storage);
  let master: GainNode | null = null;
  let volume = Math.min(MAX_VOLUME, persisted.music);
  let masterVol = persisted.master;
  let muted = persisted.muted;
  let intensity = 0;
  let disposed = false;
  let noiseBuf: AudioBuffer | null = null;

  interface Layer {
    def: LayerDef;
    /** Gain carrying the stem's intensity weight. */
    gain: GainNode;
    /** Input node that note envelopes feed (filter input, or gain). */
    bus: AudioNode;
    filter?: BiquadFilterNode;
  }
  interface Playing {
    track: MusicTrack;
    gain: GainNode;
    timer: ReturnType<typeof setInterval>;
    sources: Set<AudioScheduledSourceNode>;
    layers: Layer[];
  }
  let current: Playing | null = null;

  // Two-level bus: master gain node carries masterVol * music level.
  function masterTarget(): number {
    return muted ? 0 : masterVol * volume;
  }

  function ensureMaster(): GainNode {
    if (!master) {
      master = ac.createGain();
      master.gain.value = masterTarget();
      master.connect(ac.destination);
    }
    return master;
  }

  function getNoise(): AudioBuffer {
    if (!noiseBuf) {
      const rnd = mulberry32(0xf507);
      const len = Math.floor(ac.sampleRate * 0.5);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = rnd() * 2 - 1;
    }
    return noiseBuf;
  }

  function scheduleNote(
    p: Playing,
    layer: Layer,
    part: VoicePart,
    ev: NoteEvent,
    t0: number,
    spb: number,
  ): void {
    const dur = ev.beats * spb;
    const peak = part.gain * ev.vel * 0.3;
    const osc = ac.createOscillator();
    osc.type = part.wave;
    osc.frequency.value = midiToFreq(ev.midi);
    if (part.detune) osc.detune.value = part.detune;
    const g = ac.createGain();
    const a = Math.min(part.attack, dur * 0.5);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.setValueAtTime(peak, t0 + Math.max(a, dur - 0.08));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(g).connect(layer.bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    p.sources.add(osc);
    osc.onended = () => p.sources.delete(osc);
  }

  function schedulePerc(p: Playing, layer: Layer, ev: PercEvent, t0: number): void {
    const src = ac.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    const flt = ac.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = ev.freq;
    flt.Q.value = 1.2;
    const g = ac.createGain();
    const peak = ev.vel * 0.4;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    g.gain.linearRampToValueAtTime(0, t0 + ev.dur);
    src.connect(flt).connect(g).connect(layer.bus);
    src.start(t0);
    src.stop(t0 + ev.dur + 0.05);
    p.sources.add(src);
    src.onended = () => p.sources.delete(src);
  }

  /** Rout stems also close their lowpass as they fade in. */
  function layerFilterFreq(lp: number | undefined, w: number): number {
    if (lp === undefined) return 0;
    return Math.min(12000, lp * (1 + 5 * (1 - w)));
  }

  /**
   * Ramp every stem's weight toward the current intensity — in place.
   * Each stem uses its own fade length (LAYER_FADE_SEC), so the layers
   * crossfade on slightly different timescales instead of snapping.
   */
  function applyLayers(p: Playing, when: number, fadeScale = 1): void {
    for (const l of p.layers) {
      const w = layerWeight(l.def.layer, intensity);
      const dur = Math.max(0.05, LAYER_FADE_SEC[l.def.layer] * fadeScale);
      const g = l.gain.gain;
      g.cancelScheduledValues(when);
      g.setValueAtTime(g.value, when);
      g.linearRampToValueAtTime(w, when + dur);
      if (l.filter) {
        const f = l.filter.frequency;
        f.cancelScheduledValues(when);
        f.setValueAtTime(f.value, when);
        f.linearRampToValueAtTime(layerFilterFreq(l.def.lpFreq, w), when + dur);
      }
    }
  }

  function startTrack(track: MusicTrack, fadeIn: number): Playing {
    const def = TRACKS[track];
    const spb = 60 / def.bpm;
    const loopSec = trackDuration(def);
    const gain = ac.createGain();
    gain.connect(ensureMaster());
    const now = ac.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + Math.max(0.01, fadeIn));

    // One persistent weight gain per stem; tracks without explicit layers
    // get a single always-on 'base' stem.
    const layerDefs: LayerDef[] =
      def.layers ?? [{ layer: 'base', parts: def.parts, perc: def.perc }];
    const layers: Layer[] = layerDefs.map((ld) => {
      const g = ac.createGain();
      const w = layerWeight(ld.layer, intensity);
      g.gain.setValueAtTime(w, now);
      g.connect(gain);
      let bus: AudioNode = g;
      let filter: BiquadFilterNode | undefined;
      if (ld.lpFreq !== undefined) {
        filter = ac.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = layerFilterFreq(ld.lpFreq, w);
        filter.connect(g);
        bus = filter;
      }
      return { def: ld, gain: g, bus, filter };
    });

    const p: Playing = { track, gain, timer: 0 as never, sources: new Set(), layers };
    // Flatten all events into a beat-sorted schedule.
    interface SchedEv { beat: number; fn: (t0: number) => void }
    const events: SchedEv[] = [];
    for (const layer of layers) {
      for (const part of layer.def.parts) {
        for (const ev of part.notes) {
          events.push({ beat: ev.beat, fn: (t0) => scheduleNote(p, layer, part, ev, t0, spb) });
        }
      }
      for (const ev of layer.def.perc) {
        events.push({ beat: ev.beat, fn: (t0) => schedulePerc(p, layer, ev, t0) });
      }
    }
    events.sort((a, b) => a.beat - b.beat);
    const loopBeats = def.bars * def.beatsPerBar;

    let loopStart = ac.currentTime + 0.05;
    let idx = 0;
    const tick = (): void => {
      const horizon = ac.currentTime + LOOKAHEAD_SEC;
      for (;;) {
        const ev = events[idx];
        const t0 = loopStart + ev.beat * spb;
        if (t0 > horizon) break;
        if (t0 >= ac.currentTime - 0.01) ev.fn(Math.max(t0, ac.currentTime));
        idx++;
        if (idx >= events.length) {
          idx = 0;
          loopStart += loopSec;
        }
        if (loopStart + loopBeats * spb <= ac.currentTime) {
          loopStart = ac.currentTime + 0.01; // resync if the tab slept
        }
      }
    };
    tick();
    p.timer = setInterval(tick, TICK_MS);
    return p;
  }

  function killPlaying(p: Playing, fadeSec: number): void {
    clearInterval(p.timer);
    const now = ac.currentTime;
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setValueAtTime(p.gain.gain.value, now);
    p.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.01, fadeSec));
    const stopAt = now + Math.max(0.01, fadeSec) + 0.05;
    for (const s of p.sources) {
      try {
        s.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => p.gain.disconnect(), (fadeSec + 0.2) * 1000);
  }

  function retargetMaster(): void {
    if (master) {
      const now = ac.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(masterTarget(), now + 0.05);
    }
  }

  return {
    get volume() {
      return volume;
    },
    get masterVolume() {
      return masterVol;
    },
    get muted() {
      return muted;
    },
    play(track) {
      if (disposed) return;
      if (current?.track === track) return;
      if (current) killPlaying(current, 0.15);
      // A suspended/closed context must no-op, not throw.
      try {
        current = startTrack(track, 0.3);
      } catch {
        current = null;
      }
    },
    stop() {
      if (current) {
        killPlaying(current, 0.15);
        current = null;
      }
    },
    setVolume(v) {
      volume = Math.min(MAX_VOLUME, Math.max(0, v));
      saveAudioState(storage, { music: volume });
      retargetMaster();
    },
    setMasterVolume(v) {
      masterVol = Math.min(1, Math.max(0, v));
      saveAudioState(storage, { master: masterVol });
      retargetMaster();
    },
    setIntensity(v, opts) {
      const x = Math.min(1, Math.max(0, v));
      if (Math.abs(x - intensity) < 1e-3) return;
      intensity = x;
      if (current) applyLayers(current, ac.currentTime, opts?.fadeScale);
    },
    setMuted(m) {
      if (muted === m) return;
      muted = m;
      saveAudioState(storage, { muted });
      if (master) {
        master.gain.setTargetAtTime(masterTarget(), ac.currentTime, 0.05);
      }
    },
    crossfade(track, seconds) {
      if (disposed) return;
      if (current?.track === track) return;
      // Clamp into the 0.3–0.6s window so scene switches always
      // crossfade instead of hard-cutting or dragging out.
      const sec = Math.min(
        CROSSFADE_MAX_SEC,
        Math.max(CROSSFADE_MIN_SEC, seconds),
      );
      if (current) killPlaying(current, sec);
      try {
        current = startTrack(track, sec);
      } catch {
        current = null;
      }
    },
    dispose() {
      disposed = true;
      if (current) {
        killPlaying(current, 0.05);
        current = null;
      }
      if (master) {
        master.disconnect();
        master = null;
      }
    },
  };
}
