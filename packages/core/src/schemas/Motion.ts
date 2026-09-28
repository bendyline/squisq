/**
 * Motion Profiles
 *
 * A motion profile is the one knob that decides how much a document moves:
 * whether chart bars grow or simply fade in, whether a headline statistic
 * counts up, whether diagram edges draw themselves, how photo-grid tiles
 * arrive, and which entrance text layers use. Templates never branch on a
 * profile name; they call the helpers in `doc/utils/themeUtils.ts`
 * (`motionEntrance`, `getMotionProfile`) and read the resolved profile off
 * `TemplateContext.motion`.
 *
 * Three built-in profiles ship:
 *
 * - `calm`        — exactly the output squisq produced before motion profiles
 *                   existed. Templates receive their own fallback animations
 *                   unchanged, so `calm` is byte-identical to "no profile".
 * - `documentary` — measured build-ins: fade-up entrances, charts grow over
 *                   ~1 s, statistics count up, diagrams draw on.
 * - `vibrant`     — the same vocabulary, snappier and with a little overshoot.
 *
 * Precedence (highest first) — see {@link resolveMotionForDoc}:
 *   explicit override (player prop / CLI `--motion`) → `Doc.motion` →
 *   frontmatter `squisq-motion` → `theme.renderStyle.motionProfile` → `calm`.
 *
 * Every effect a profile enables is a CSS keyframe animation (seekable by the
 * offline renderer through the Web Animations API) or a pure function of the
 * block clock (count-up), so exported frames are deterministic.
 *
 * Related files:
 * - `schemas/Doc.ts` — `Animation` / `AnimationType` vocabulary, `Doc.motion`
 * - `schemas/Theme.ts` — `RenderStyle.motionProfile`
 * - `doc/utils/themeUtils.ts` — template-facing helpers
 * - `doc/utils/countUp.ts` — the pure count-up formatter
 * - `doc/templates/*` — templates that opt in (chart, statHighlight,
 *   comparisonBar, diagram, timeline, photoGrid, cover, …)
 */

import type { Theme } from './Theme.js';

/** Names of the built-in motion profiles. */
export type MotionProfileName = 'calm' | 'documentary' | 'vibrant';

const MOTION_PROFILE_NAMES: readonly MotionProfileName[] = ['calm', 'documentary', 'vibrant'];

/** Frontmatter key that selects a document's motion profile. */
export const FRONTMATTER_MOTION_KEY = 'squisq-motion';

/**
 * Entrance a profile applies to text layers that opt in through
 * `motionEntrance()`. Templates keep their authored delays and staggers;
 * `delayScale` compresses or stretches them as a whole.
 */
export interface MotionEntrance {
  type: 'fadeIn' | 'fadeInUp' | 'zoomIn' | 'grow';
  /** Seconds. */
  duration: number;
  /** CSS easing. */
  easing?: string;
  /** Multiplier on template-authored delays (1 keeps the authored stagger). */
  delayScale: number;
}

/** The resolved set of motion decisions templates read. */
export interface MotionProfile {
  name: MotionProfileName;
  /** Entrance for text and caption layers that opt in. */
  textEntrance: MotionEntrance;
  /** Chart marks grow (bars/columns), draw on (lines) or sweep out (pies) instead of fading. */
  chartGrowth: boolean;
  /** Seconds a chart's growth takes. */
  chartGrowthDuration: number;
  /** Headline numbers (statHighlight, comparisonBar) count up from zero. */
  countUp: boolean;
  /** Seconds a count-up takes. */
  countUpDuration: number;
  /** Diagram nodes pop in and edges draw on; timeline tracks and stems draw on. */
  diagramBuild: boolean;
  /** Seconds between photo-grid tiles revealing; `0` keeps the plain fade. */
  photoGridStagger: number;
  /** Cover title reveals word by word. Off by default — covers double as posters. */
  coverWordReveal: boolean;
}

/**
 * What a document, a theme or a caller may specify: a profile name, or a
 * named profile with field overrides (`{ profile: 'documentary', countUp: false }`).
 */
export type MotionSpec =
  | MotionProfileName
  | (Partial<Omit<MotionProfile, 'name' | 'textEntrance'>> & {
      profile?: MotionProfileName;
      textEntrance?: Partial<MotionEntrance>;
    })
  | MotionProfile;

const OVERSHOOT_EASING = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
const SETTLE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** The built-in profiles. `calm` reproduces pre-profile output exactly. */
export const MOTION_PROFILES: Readonly<Record<MotionProfileName, MotionProfile>> = Object.freeze({
  calm: Object.freeze({
    name: 'calm',
    textEntrance: Object.freeze({ type: 'fadeIn', duration: 1, delayScale: 1 }),
    chartGrowth: false,
    chartGrowthDuration: 1,
    countUp: false,
    countUpDuration: 1.5,
    diagramBuild: false,
    photoGridStagger: 0,
    coverWordReveal: false,
  }),
  documentary: Object.freeze({
    name: 'documentary',
    textEntrance: Object.freeze({
      type: 'fadeInUp',
      duration: 0.8,
      easing: SETTLE_EASING,
      delayScale: 1,
    }),
    chartGrowth: true,
    chartGrowthDuration: 1.1,
    countUp: true,
    countUpDuration: 1.6,
    diagramBuild: true,
    photoGridStagger: 0.22,
    coverWordReveal: false,
  }),
  vibrant: Object.freeze({
    name: 'vibrant',
    textEntrance: Object.freeze({
      type: 'fadeInUp',
      duration: 0.55,
      easing: OVERSHOOT_EASING,
      delayScale: 0.8,
    }),
    chartGrowth: true,
    chartGrowthDuration: 0.9,
    countUp: true,
    countUpDuration: 1.2,
    diagramBuild: true,
    photoGridStagger: 0.16,
    coverWordReveal: false,
  }),
} satisfies Record<MotionProfileName, MotionProfile>);

/** Type guard for a built-in profile name. */
export function isMotionProfileName(value: unknown): value is MotionProfileName {
  return typeof value === 'string' && (MOTION_PROFILE_NAMES as readonly string[]).includes(value);
}

/**
 * Resolve a spec to a complete profile. An unknown name or a malformed spec
 * falls back to `fallback` (default `calm`) rather than throwing: motion is
 * decorative and must never stop a document from rendering.
 */
export function resolveMotionProfile(
  spec: MotionSpec | null | undefined,
  fallback: MotionProfileName = 'calm',
): MotionProfile {
  if (spec == null) return MOTION_PROFILES[fallback];
  if (typeof spec === 'string') {
    return MOTION_PROFILES[isMotionProfileName(spec) ? spec : fallback];
  }
  if (typeof spec !== 'object') return MOTION_PROFILES[fallback];
  // A resolved profile (`{ name, … }`) is its own base; an override object
  // names its base with `profile`, else inherits the fallback's.
  const named = spec as { profile?: unknown; name?: unknown };
  const baseName = isMotionProfileName(named.profile)
    ? named.profile
    : isMotionProfileName(named.name)
      ? named.name
      : fallback;
  const base = MOTION_PROFILES[baseName];
  const { profile: _profile, name: _name, ...overrides } = spec as Record<string, unknown>;
  const merged: MotionProfile = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (key === 'textEntrance' && typeof value === 'object' && value !== null) {
      merged.textEntrance = { ...base.textEntrance, ...(value as Partial<MotionEntrance>) };
    } else if (key in base && typeof value === typeof base[key as keyof MotionProfile]) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/**
 * Read the motion spec a markdown document carries in its frontmatter
 * (`squisq-motion: vibrant`, or an object with overrides). Returns
 * `undefined` when absent or unusable.
 */
export function readFrontmatterMotion(
  frontmatter: Record<string, unknown> | undefined,
): MotionSpec | undefined {
  if (!frontmatter) return undefined;
  const raw = frontmatter[FRONTMATTER_MOTION_KEY] ?? frontmatter.motion;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return isMotionProfileName(trimmed) ? trimmed : undefined;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as MotionSpec;
  return undefined;
}

/**
 * Resolve the effective motion profile for a document.
 *
 * Precedence: `explicit` (a player prop or CLI flag) → `doc.motion` →
 * frontmatter `squisq-motion` → `theme.renderStyle.motionProfile` → `calm`.
 * A doc-level spec may be a partial override; its base profile is the
 * theme's when it names none.
 */
export function resolveMotionForDoc(
  doc: { motion?: MotionSpec; frontmatter?: Record<string, unknown> } | null | undefined,
  theme?: Pick<Theme, 'renderStyle'> | null,
  explicit?: MotionSpec | null,
): MotionProfile {
  const themeName = theme?.renderStyle.motionProfile;
  const themeDefault: MotionProfileName = isMotionProfileName(themeName) ? themeName : 'calm';
  const spec = explicit ?? doc?.motion ?? readFrontmatterMotion(doc?.frontmatter);
  return resolveMotionProfile(spec, themeDefault);
}
