/**
 * Dashboard layout selection: id lookup plus the auto-pick ladder that
 * chooses the smallest layout able to hold every block.
 */

import type { ViewportOrientation } from '../../schemas/Viewport.js';
import type { DashboardLayoutDefinition } from './DashboardLayout.js';
import { layoutCapacity } from './DashboardLayout.js';
import { BUILTIN_DASHBOARD_LAYOUTS } from './builtinDashboardLayouts.js';

/** The sentinel layout id meaning "pick the best layout for the doc". */
export const DASHBOARD_AUTO_LAYOUT_ID = 'auto';

/**
 * Resolve a layout id against the document's custom layouts (which win
 * name collisions) and then the built-ins. Undefined when unknown.
 */
export function resolveDashboardLayoutDefinition(
  id: string,
  customLayouts?: readonly DashboardLayoutDefinition[],
): DashboardLayoutDefinition | undefined {
  const normalized = id.trim().toLowerCase();
  if (!normalized) return undefined;
  return (
    customLayouts?.find((def) => def.name === normalized) ??
    BUILTIN_DASHBOARD_LAYOUTS.find((def) => def.name === normalized)
  );
}

/**
 * Auto-pick the best layout for a block count: the smallest-capacity
 * auto-eligible layout that fits every block, preferring a custom layout
 * over a built-in at equal capacity. When even the largest layout cannot
 * hold the count, the largest wins and the caller reports the overflow.
 *
 * Orientation deliberately does not change WHICH layout wins — it selects
 * the cell variant later (via `resolveLayoutCells`) so the same document
 * keeps the same layout identity across aspect ratios.
 */
export function chooseDashboardLayout(
  blockCount: number,
  _orientation: ViewportOrientation,
  customLayouts?: readonly DashboardLayoutDefinition[],
): DashboardLayoutDefinition {
  const pool = [
    ...(customLayouts ?? []).filter((def) => def.auto !== false),
    ...BUILTIN_DASHBOARD_LAYOUTS.filter((def) => def.auto !== false),
  ];
  // Stable sort keeps customs ahead of built-ins at equal capacity.
  const ladder = [...pool].sort((a, b) => layoutCapacity(a) - layoutCapacity(b));
  const needed = Math.max(1, blockCount);
  const fit = ladder.find((def) => layoutCapacity(def) >= needed);
  if (fit) return fit;
  // Nothing fits: take the largest capacity (first entry holding it, so a
  // custom layout still wins the tie).
  const max = ladder.reduce((acc, def) => Math.max(acc, layoutCapacity(def)), 0);
  return ladder.find((def) => layoutCapacity(def) === max) ?? BUILTIN_DASHBOARD_LAYOUTS[0];
}
