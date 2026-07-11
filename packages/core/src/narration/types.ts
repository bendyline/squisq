/**
 * Shared types + tuning configs for the narration engine.
 *
 * The engine is pure TypeScript with zero dependencies and no DOM/Node
 * APIs: audio arrives as mono `Float32Array` PCM (the editor decodes
 * WebM/MP4 on its side), and every stage is a deterministic step
 * function `(state, input, config) → state` so the whole pipeline is
 * unit-testable in Node with synthetic signals. No `Date.now`, no
 * `Math.random`, no timers anywhere in this module.
 */

/** One word of the teleprompter script, positioned inside {@link NarrationScript.sourceText}. */
export interface ScriptToken {
  /** The word as displayed (no surrounding whitespace). */
  text: string;
  /** Start offset into {@link NarrationScript.sourceText}. */
  charOffset: number;
  /** Exclusive end offset into {@link NarrationScript.sourceText}. */
  charEnd: number;
  /** Id of the doc block this word belongs to. */
  blockId: string;
  /** Index into {@link NarrationScript.blocks}. */
  blockIndex: number;
  /** Estimated syllable count (≥ 1; numbers via spoken-word expansion). */
  syllables: number;
  /** Spoken-word equivalents (numbers count as several words). */
  spokenWordEquiv: number;
  /**
   * Pause class after this token:
   * 0 none · 1 clause/sentence punctuation · 2 paragraph break · 3 block boundary.
   */
  pauseAfter: 0 | 1 | 2 | 3;
}

/** The token/char span of one doc block inside the script. */
export interface ScriptBlockRange {
  blockId: string;
  /** The block's heading text, when present. */
  heading?: string;
  /** Inclusive index into {@link NarrationScript.tokens}. */
  tokenStart: number;
  /** Exclusive index into {@link NarrationScript.tokens}. */
  tokenEnd: number;
  /** Start offset into {@link NarrationScript.sourceText} (includes the spoken title). */
  charStart: number;
  /** Exclusive end offset into {@link NarrationScript.sourceText}. */
  charEnd: number;
}

/**
 * The teleprompter script derived from a Doc. `sourceText` is canonical:
 * it is stored verbatim in the timing sidecar, and every `charOffset`
 * indexes into it. Building is deterministic — the same Doc always
 * yields a byte-identical script.
 */
export interface NarrationScript {
  sourceText: string;
  tokens: ScriptToken[];
  blocks: ScriptBlockRange[];
  totalSyllables: number;
  /**
   * Prefix sums: `cumulativeSyllables[i]` = syllables of `tokens[0..i-1]`.
   * Length is `tokens.length + 1`.
   */
  cumulativeSyllables: number[];
}

/** Per-frame acoustic features extracted from PCM. */
export interface FrameFeatures {
  /** Frame CENTER time in seconds from the start of the signal. */
  tSec: number;
  /** Full-band root-mean-square of the frame. */
  rms: number;
  /** Mean square of the 250–3000 Hz bandpassed frame (speech band energy). */
  bandEnergy: number;
  /** Zero crossings / (frameLength − 1), in [0, 1]. */
  zcr: number;
}

// ── Configs ──────────────────────────────────────────────────────────

export interface FeatureConfig {
  /** Analysis frame length in samples (~21 ms @ 48 kHz). */
  frameSize: number;
  /** Hop between frame starts in seconds (live 0.02; the aligner uses 0.01). */
  hopSec: number;
  /** Bandpass high-pass corner (Hz). */
  bandLowHz: number;
  /** Bandpass low-pass corner (Hz). */
  bandHighHz: number;
}

export const DEFAULT_FEATURE_CONFIG: FeatureConfig = Object.freeze({
  frameSize: 1024,
  hopSec: 0.02,
  bandLowHz: 250,
  bandHighHz: 3000,
});

export interface VadConfig {
  /** Floor-seeding period before any speech decision (ms). */
  warmupMs: number;
  /** Floor attack toward minima (per-frame EMA alpha when energy < floor). */
  alphaDown: number;
  /** Floor release (per-frame EMA alpha when energy ≥ floor; frozen while speaking). */
  alphaUp: number;
  /** Enter speech when energy > floor × enterRatio for enterFrames frames. */
  enterRatio: number;
  /**
   * Exit hysteresis: sub-exit frames only count once energy < floor ×
   * exitRatio. The floor is a LOW-percentile tracker, so steady room
   * noise runs ~1.8–2.3× above it — exitRatio must sit above that band
   * (and below enterRatio) or silence never registers.
   */
  exitRatio: number;
  /** Consecutive supra-enter frames required to enter speech. */
  enterFrames: number;
  /** Sub-exit dwell required to leave speech (ms). */
  hangoverMs: number;
  /**
   * Dip-starved rebaseline: real speech dips below enterRatio × floor
   * between syllables; a "speech" that stays strongly above the floor
   * for this long with zero dips is a shifted noise floor — adopt it
   * and exit. Guards against a step change in room noise wedging the
   * VAD open forever (the floor is otherwise frozen while speaking).
   */
  noiseRebaselineSec: number;
  /** Absolute floor clamp guarding digital silence. */
  floorMin: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = Object.freeze({
  warmupMs: 200,
  alphaDown: 0.3,
  alphaUp: 0.005,
  enterRatio: 3.0,
  exitRatio: 2.5,
  enterFrames: 2,
  hangoverMs: 300,
  noiseRebaselineSec: 1.5,
  floorMin: 1e-9,
});

export interface NucleiConfig {
  /** One-pole low-pass cutoff for the amplitude envelope (Hz). */
  envelopeHz: number;
  /** Minimum spacing between accepted syllable onsets (ms) — caps ~8.3 syl/s. */
  minInterOnsetMs: number;
  /** Peak must exceed valley-since-last-peak × this ratio. */
  prominenceRatio: number;
  /** Peak must exceed the decaying loudness reference × this fraction. */
  minRelPeak: number;
  /** Decay time constant of the loudness reference (s). */
  peakRefTauSec: number;
}

export const DEFAULT_NUCLEI_CONFIG: NucleiConfig = Object.freeze({
  envelopeHz: 10,
  minInterOnsetMs: 120,
  prominenceRatio: 1.6,
  minRelPeak: 0.1,
  peakRefTauSec: 3.0,
});

export interface PacingConfig {
  /** The user's base speaking rate (words per minute). */
  baseWpm: number;
  /** Clamp on the voice-derived rate multiplier. */
  minRateMult: number;
  maxRateMult: number;
  /** EMA time constant for the detected syllable rate (s). */
  rateEmaTauSec: number;
  /** Velocity slew time constant while speaking (s). */
  velSlewTauSec: number;
  /** Velocity decay time constant in silence (s) — halted within ~250 ms. */
  haltTauSec: number;
  /** PI proportional gain (per syllable of cumulative error). */
  kP: number;
  /** PI integral gain (per syllable·second). */
  kI: number;
  /** Anti-windup clamp on the error integral (syllable·seconds). */
  intClamp: number;
  /** Max fraction of target velocity the PI correction may add/remove. */
  maxCorrection: number;
  /** Window (words ahead) used for the local expected syllables-per-word. */
  sylWindowWords: number;
  /** Silence within this many words of a pauseAfter ≥ 2 token accrues no error. */
  breakLookaheadWords: number;
  /** |cumulative error| beyond this hard-resyncs the prompter position. */
  resyncSyllables: number;
}

export const DEFAULT_PACING_CONFIG: PacingConfig = Object.freeze({
  baseWpm: 150,
  minRateMult: 0.35,
  maxRateMult: 2.0,
  rateEmaTauSec: 0.8,
  velSlewTauSec: 0.25,
  haltTauSec: 0.085,
  kP: 0.12,
  kI: 0.015,
  intClamp: 4,
  maxCorrection: 0.5,
  sylWindowWords: 8,
  breakLookaheadWords: 2,
  resyncSyllables: 8,
});

export interface AlignConfig {
  /** Fine analysis hop for the offline pass (s). */
  hopSec: number;
  /** Non-speech runs at least this long become GAP events (s). */
  gapMinSec: number;
  /** Sakoe-Chiba band half-width around the live-trace prior (s). */
  bandRadiusSec: number;
  /** Band half-width when no trace exists (s); also floored at 10% of take length. */
  bandRadiusNoTraceSec: number;
  /** Cost weight for |Δt| on syllable↔syllable matches (normalized by band radius). */
  matchTimeWeight: number;
  /** Cost of matching an expected pause slot to a detected syllable (reader didn't pause). */
  pauseToSylCost: number;
  /** Cost of matching an expected syllable slot to a detected gap (mid-sentence hesitation). */
  sylToGapCost: number;
  /** Cost of skipping an expected slot (merged/unspoken syllable). */
  deleteCost: number;
  /** Cost of skipping a detected event (filler word, breath, click). */
  insertCost: number;
  /** Snap a block start to a silence-gap end within this window before it (s). */
  blockSnapWindowSec: number;
  /** Padding after the last speech for the final block's end (s). */
  tailPadSec: number;
}

export const DEFAULT_ALIGN_CONFIG: AlignConfig = Object.freeze({
  hopSec: 0.01,
  gapMinSec: 0.35,
  bandRadiusSec: 1.5,
  bandRadiusNoTraceSec: 3,
  matchTimeWeight: 1.0,
  pauseToSylCost: 2.0,
  sylToGapCost: 1.5,
  deleteCost: 0.8,
  insertCost: 0.8,
  blockSnapWindowSec: 0.8,
  tailPadSec: 0.4,
});

// ── Alignment outputs ────────────────────────────────────────────────

/** Refined timestamp of one script token. */
export interface WordTiming {
  tokenIndex: number;
  /** Seconds into the take when the word begins. Monotonically non-decreasing. */
  tSec: number;
  /** True when this word had no matched syllable and was interpolated. */
  interpolated: boolean;
}

/** Narration time range of one doc block. Ranges are CONTIGUOUS: endSec === next.startSec. */
export interface NarrationBlockRange {
  blockId: string;
  heading?: string;
  blockIndex: number;
  charStart: number;
  charEnd: number;
  startSec: number;
  endSec: number;
}

export interface NarrationAlignment {
  /** One entry per script token, monotonic in time. */
  words: WordTiming[];
  blocks: NarrationBlockRange[];
  /** Total syllable onsets detected in the take (diagnostics). */
  detectedSyllables: number;
  /** Total DTW path cost (diagnostics/QA). */
  cost: number;
}
