/**
 * Dashboard cell zoom policy.
 *
 * A cell's "zoom" multiplies the type scale (`TemplateContext.fontScale`)
 * its block renders with — the %-based composition still targets the cell,
 * but titles and body text render 1.5×/2× so a sparse block fills its slot
 * instead of floating in whitespace. Zoom is deliberately a CLOSED ladder
 * (100% / 150% / 200%), and a dashboard uses at most TWO unique levels —
 * base 1× plus one boost — so cells still read as consistently sized
 * rather than each block being fitted independently.
 *
 * Levels come from three places, strongest first: an explicit `zoom` on a
 * custom layout's cell definition (author intent — never changed), the
 * automatic density pick (short text-led blocks get boosted; spatial,
 * media, chart, and display-scaled templates always render 1×), and the
 * `squisq-dashboard-zoom: off` frontmatter kill-switch that pins every
 * non-explicit cell to 1×.
 */

/** The closed set of zoom multipliers a dashboard cell may render at. */
export const DASHBOARD_ZOOM_LEVELS = [1, 1.5, 2] as const;

export type DashboardZoomLevel = (typeof DASHBOARD_ZOOM_LEVELS)[number];

/** Automatic zoom behavior: density-based boosts, or everything at 1×. */
export type DashboardZoomMode = 'auto' | 'off';

/**
 * Normalize an authored zoom value to a ladder level. Accepts multipliers
 * (`1`, `1.5`, `2`) and percentages (`100`, `150`, `200`, `'200%'`).
 * Returns undefined for anything off the ladder.
 */
export function normalizeDashboardZoom(value: unknown): DashboardZoomLevel | undefined {
  const raw =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim().replace(/%$/, ''))
        : Number.NaN;
  if (!Number.isFinite(raw)) return undefined;
  const multiplier = raw > 3 ? raw / 100 : raw;
  return DASHBOARD_ZOOM_LEVELS.find((level) => Math.abs(level - multiplier) < 0.001);
}

/**
 * Templates whose composition is text-led at document scale — the ones
 * that look lost in a small cell. Display-scaled templates (statHighlight,
 * pullQuote, fullBleedQuote, title…) and spatial/media/chart templates
 * already fill their canvas and always render at 1×.
 */
const ZOOM_ELIGIBLE_TEMPLATES: ReadonlySet<string> = new Set([
  'content',
  'list',
  'quote',
  'definitionCard',
  'factCard',
  'dateEvent',
]);

/** Below this much text (title + body), a text-led cell reads best at 2×. */
const ZOOM_200_MAX_CHARS = 160;
/** Below this much text, 1.5×; anything longer stays at 1×. */
const ZOOM_150_MAX_CHARS = 360;

/** One cell's input to the zoom policy. */
export interface DashboardZoomCandidate {
  /** Resolved template name of the block in this cell. */
  template?: string;
  /** Plain-text length of the block's title + body. */
  textLength: number;
  /** Author-pinned level from the layout's cell definition. */
  explicit?: DashboardZoomLevel;
}

/** The density pick for one cell, before the two-level quantization. */
export function desiredCellZoom(candidate: DashboardZoomCandidate): DashboardZoomLevel {
  if (!candidate.template || !ZOOM_ELIGIBLE_TEMPLATES.has(candidate.template)) return 1;
  if (candidate.textLength < ZOOM_200_MAX_CHARS) return 2;
  if (candidate.textLength < ZOOM_150_MAX_CHARS) return 1.5;
  return 1;
}

/**
 * Resolve every cell's final zoom level.
 *
 * Explicit levels are honored verbatim. Automatic picks are then
 * quantized so the dashboard as a whole uses at most base 1× plus ONE
 * boost level: when both 1.5× and 2× are wanted, the boost with the most
 * cells wins (explicit pins count double so autos rally to the author's
 * level; ties boost to 2×), and the other autos snap to it.
 */
export function resolveDashboardZooms(
  candidates: readonly DashboardZoomCandidate[],
  mode: DashboardZoomMode,
): DashboardZoomLevel[] {
  const levels = candidates.map((candidate) => {
    if (candidate.explicit !== undefined) return candidate.explicit;
    return mode === 'auto' ? desiredCellZoom(candidate) : 1;
  });

  const boostVotes = new Map<DashboardZoomLevel, number>();
  candidates.forEach((candidate, index) => {
    const level = levels[index];
    if (level === 1) return;
    const weight = candidate.explicit !== undefined ? 2 : 1;
    boostVotes.set(level, (boostVotes.get(level) ?? 0) + weight);
  });
  if (boostVotes.size <= 1) return levels;

  let winner: DashboardZoomLevel = 2;
  let winnerVotes = -1;
  for (const [level, votes] of boostVotes) {
    if (votes > winnerVotes || (votes === winnerVotes && level > winner)) {
      winner = level;
      winnerVotes = votes;
    }
  }
  return candidates.map((candidate, index) => {
    if (candidate.explicit !== undefined) return candidate.explicit;
    return levels[index] === 1 ? 1 : winner;
  });
}
