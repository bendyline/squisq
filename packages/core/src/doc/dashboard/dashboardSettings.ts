/**
 * Dashboard settings persisted in Markdown frontmatter.
 *
 * Framework-free (model: `coverSlideSettings.ts`) so the editor, player,
 * and export pipelines resolve one canonical document contract:
 *
 * - `squisq-dashboard-layout`: layout id or `auto` (default `auto`).
 * - `squisq-dashboard-title`: whether the document title band renders
 *   (default true; the band only appears when a title actually resolves).
 */

import { DASHBOARD_AUTO_LAYOUT_ID } from './chooseDashboardLayout.js';
import type { DashboardZoomMode } from './dashboardZoom.js';

export interface DashboardSettings {
  /** Preferred layout id, or {@link DASHBOARD_AUTO_LAYOUT_ID}. */
  layout: string;
  /** Whether the document-title band renders when a title resolves. */
  showTitle: boolean;
  /** Cell zoom behavior: density-based `auto` boosts, or `off` (all 1×). */
  zoom: DashboardZoomMode;
}

export const DASHBOARD_FRONTMATTER_KEYS = Object.freeze({
  layout: { canonical: 'squisq-dashboard-layout', legacy: 'dashboard-layout' },
  showTitle: { canonical: 'squisq-dashboard-title', legacy: 'dashboard-title' },
  zoom: { canonical: 'squisq-dashboard-zoom', legacy: 'dashboard-zoom' },
});

export const DEFAULT_DASHBOARD_SETTINGS: Readonly<DashboardSettings> = Object.freeze({
  layout: DASHBOARD_AUTO_LAYOUT_ID,
  showTitle: true,
  zoom: 'auto',
});

function readSetting(
  frontmatter: Record<string, unknown> | undefined,
  keys: { canonical: string; legacy: string },
): unknown {
  if (!frontmatter) return undefined;
  return Object.prototype.hasOwnProperty.call(frontmatter, keys.canonical)
    ? frontmatter[keys.canonical]
    : frontmatter[keys.legacy];
}

function resolveBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'on', 'show', 'visible'].includes(normalized)) return true;
  if (['false', 'no', 'off', 'hide', 'hidden'].includes(normalized)) return false;
  return undefined;
}

/**
 * Normalize a layout id. Any non-empty string passes (validity against the
 * layout pool is checked at materialize time, so an unknown id degrades to
 * auto with a diagnostic instead of being silently dropped here).
 */
function resolveLayoutId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'auto' || normalized === 'default') return DASHBOARD_AUTO_LAYOUT_ID;
  return normalized;
}

function resolveZoomMode(value: unknown): DashboardZoomMode | undefined {
  if (typeof value === 'boolean') return value ? 'auto' : 'off';
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['auto', 'on', 'true', 'yes'].includes(normalized)) return 'auto';
  if (['off', 'false', 'no', 'none', '100', '100%', '1'].includes(normalized)) return 'off';
  return undefined;
}

/** Resolve dashboard settings from frontmatter, then apply caller overrides. */
export function resolveDashboardSettings(
  frontmatter: Record<string, unknown> | undefined,
  overrides: Partial<DashboardSettings> = {},
): DashboardSettings {
  const resolved: DashboardSettings = {
    layout:
      resolveLayoutId(readSetting(frontmatter, DASHBOARD_FRONTMATTER_KEYS.layout)) ??
      DEFAULT_DASHBOARD_SETTINGS.layout,
    showTitle:
      resolveBoolean(readSetting(frontmatter, DASHBOARD_FRONTMATTER_KEYS.showTitle)) ??
      DEFAULT_DASHBOARD_SETTINGS.showTitle,
    zoom:
      resolveZoomMode(readSetting(frontmatter, DASHBOARD_FRONTMATTER_KEYS.zoom)) ??
      DEFAULT_DASHBOARD_SETTINGS.zoom,
  };
  return {
    layout: resolveLayoutId(overrides.layout) ?? resolved.layout,
    showTitle: overrides.showTitle ?? resolved.showTitle,
    zoom: overrides.zoom ?? resolved.zoom,
  };
}
