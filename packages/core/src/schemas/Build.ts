/** Semantic reveal order is independent of decorative motion and slide transitions. */
export const BUILD_MODES = ['off', 'items', 'branches', 'chunks'] as const;
export const BUILD_EFFECTS = ['appear', 'fadeIn', 'fadeInUp', 'slideIn'] as const;
export const BUILD_PREVIOUS = ['keep', 'dim'] as const;
export interface BuildSpec {
  mode: (typeof BUILD_MODES)[number];
  effect?: (typeof BUILD_EFFECTS)[number];
  /** Entrance seconds. Reveal timing is independent of this duration. */
  duration?: number;
  previous?: (typeof BUILD_PREVIOUS)[number];
}
/** Projection-only semantic step. IDs are stable for an unchanged source. */
export interface BuildStep {
  id: string;
  text: string;
  /** Earlier steps which must remain readable for this step's context. */
  ancestors?: number[];
}
/** Number of revealed steps and progress of the most recently revealed step. */
export interface BuildCursor {
  revealed: number;
  progress: number;
}
/** Source-guarded offsets from block start, produced by narration or recording. */
export interface BuildTiming {
  sourceText: string;
  starts: number[];
}
/** First reveal of a step during a recording. Time is take-relative seconds. */
export interface BuildAdvance {
  blockId: string;
  sourceText: string;
  step: number;
  time: number;
}

export function recordBuildAdvance(
  log: readonly BuildAdvance[],
  event: BuildAdvance,
): readonly BuildAdvance[] {
  if (
    !event.blockId ||
    !event.sourceText ||
    !Number.isInteger(event.step) ||
    event.step < 0 ||
    !Number.isFinite(event.time) ||
    event.time < 0
  )
    return log;
  if (
    log.some(
      (entry) =>
        entry.blockId === event.blockId &&
        entry.step === event.step &&
        entry.sourceText === event.sourceText,
    )
  )
    return log;
  return [...log, { ...event, time: Math.max(log[log.length - 1]?.time ?? 0, event.time) }];
}
export const BUILD_PARAM_KEYS = ['build', 'buildEffect', 'buildDuration', 'buildPrevious'] as const;

export function parseBuildSpec(value: unknown): BuildSpec | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const spec = value as Record<string, unknown>;
  if (
    Object.keys(spec).some((key) => !['mode', 'effect', 'duration', 'previous'].includes(key)) ||
    !(BUILD_MODES as readonly unknown[]).includes(spec.mode) ||
    (spec.effect !== undefined && !(BUILD_EFFECTS as readonly unknown[]).includes(spec.effect)) ||
    (spec.previous !== undefined &&
      !(BUILD_PREVIOUS as readonly unknown[]).includes(spec.previous)) ||
    (spec.duration !== undefined &&
      (typeof spec.duration !== 'number' || !Number.isFinite(spec.duration) || spec.duration < 0))
  )
    return undefined;
  return { ...spec } as unknown as BuildSpec;
}

export function buildSpecParams(build: BuildSpec): Record<string, string> {
  return {
    build: build.mode,
    ...(build.effect ? { buildEffect: build.effect } : {}),
    ...(build.duration !== undefined ? { buildDuration: String(build.duration) } : {}),
    ...(build.previous ? { buildPrevious: build.previous } : {}),
  };
}
