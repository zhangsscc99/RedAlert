// Procedurally synthesized looping BGM via WebAudio. No audio assets.
// Presentation layer only: must not be imported from client/src/game/**.
// The AudioContext is injected by the caller; nothing touches the DOM here.

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
  notes: NoteEvent[];
}

export interface TrackDef {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  parts: VoicePart[];
  perc: PercEvent[];
}

export interface Music {
  play(track: MusicTrack): void;
  stop(): void;
  setVolume(v: number): void;
  readonly volume: number;
  crossfade(track: MusicTrack, seconds: number): void;
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
    parts: [
      bassPart(BATTLE_ROOTS, 0.55),
      leadPart(BATTLE_MOTIF, 4, 0.4),
    ],
    perc: percTrack(8),
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

export function createMusic(ac: AudioContext): Music {
  let master: GainNode | null = null;
  let volume = 0.25;
  let disposed = false;
  let noiseBuf: AudioBuffer | null = null;

  interface Playing {
    track: MusicTrack;
    gain: GainNode;
    timer: ReturnType<typeof setInterval>;
    sources: Set<AudioScheduledSourceNode>;
  }
  let current: Playing | null = null;

  function ensureMaster(): GainNode {
    if (!master) {
      master = ac.createGain();
      master.gain.value = volume;
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

  function scheduleNote(p: Playing, part: VoicePart, ev: NoteEvent, t0: number, spb: number): void {
    const dur = ev.beats * spb;
    const peak = part.gain * ev.vel * 0.3;
    const osc = ac.createOscillator();
    osc.type = part.wave;
    osc.frequency.value = midiToFreq(ev.midi);
    const g = ac.createGain();
    const a = Math.min(part.attack, dur * 0.5);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.setValueAtTime(peak, t0 + Math.max(a, dur - 0.08));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(g).connect(p.gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    p.sources.add(osc);
    osc.onended = () => p.sources.delete(osc);
  }

  function schedulePerc(p: Playing, ev: PercEvent, t0: number): void {
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
    src.connect(flt).connect(g).connect(p.gain);
    src.start(t0);
    src.stop(t0 + ev.dur + 0.05);
    p.sources.add(src);
    src.onended = () => p.sources.delete(src);
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

    const p: Playing = { track, gain, timer: 0 as never, sources: new Set() };
    // Flatten all events into a beat-sorted schedule.
    interface SchedEv { beat: number; fn: (t0: number) => void }
    const events: SchedEv[] = [];
    for (const part of def.parts) {
      for (const ev of part.notes) {
        events.push({ beat: ev.beat, fn: (t0) => scheduleNote(p, part, ev, t0, spb) });
      }
    }
    for (const ev of def.perc) {
      events.push({ beat: ev.beat, fn: (t0) => schedulePerc(p, ev, t0) });
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

  return {
    get volume() {
      return volume;
    },
    play(track) {
      if (disposed) return;
      if (current?.track === track) return;
      if (current) killPlaying(current, 0.15);
      current = startTrack(track, 0.3);
    },
    stop() {
      if (current) {
        killPlaying(current, 0.15);
        current = null;
      }
    },
    setVolume(v) {
      volume = Math.min(MAX_VOLUME, Math.max(0, v));
      if (master) {
        const now = ac.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(volume, now + 0.05);
      }
    },
    crossfade(track, seconds) {
      if (disposed) return;
      if (current?.track === track) return;
      if (current) killPlaying(current, seconds);
      current = startTrack(track, seconds);
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
