/**
 * Tree Template
 *
 * Renders a hierarchical filesystem-style treeview (folder/file icons +
 * connector rails, collapsible in the live player) from an ASCII tree fence.
 * Emits a single `TreeLayer` (foreignObject HTML, like `dataTable`) plus an
 * optional title + themed background.
 *
 * Data source: `input.items` (a nested `TreeLayerItem[]`), populated from
 * `templateData.items` which the pipeline derives from the tree fence.
 */

import type { Layer, TreeLayerItem } from '../../schemas/Doc.js';
import type { TreeBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  resolveColorScheme,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { createBackgroundLayer } from './captionUtils.js';

/** Defensive coercion of untyped `templateData.items` into valid tree items. */
function coerceItems(raw: unknown): TreeLayerItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TreeLayerItem[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const item = r as Record<string, unknown>;
    if (typeof item.label !== 'string') continue;
    const children = coerceItems(item.children);
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : slug(item.label),
      label: item.label,
      children,
      ...(item.isDir === true || children.length > 0 ? { isDir: true } : {}),
      ...(typeof item.comment === 'string' && item.comment ? { comment: item.comment } : {}),
    });
  }
  return out;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node'
  );
}

export function treeBlock(input: TreeBlockInput, context: TemplateContext): Layer[] {
  const { theme, viewport } = context;
  const colors = resolveColorScheme(context, input.colorScheme);
  const items = coerceItems(input.items);

  const titleFontSize = themedFontSize(48, context, true);
  const rowFontSize = themedFontSize(28, context, false);

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 170))];

  if (items.length === 0) {
    layers.push({
      type: 'text',
      id: 'tree-empty',
      content: {
        text: input.title ?? 'Empty tree',
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
      },
      position: { x: '50%', y: '50%', anchor: 'center' },
    });
    return layers;
  }

  const titleBandPct = input.title ? (titleFontSize * 2.2 * 100) / viewport.height : 0;

  if (input.title) {
    layers.push({
      type: 'text',
      id: 'title',
      content: {
        text: input.title,
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
        },
      },
      position: { x: '50%', y: `${8 + titleBandPct / 2}%`, width: '80%', anchor: 'center' },
      animation: { type: 'fadeIn', duration: 0.8 },
    });
  }

  layers.push({
    type: 'tree',
    id: 'tree',
    content: {
      items,
      style: {
        rowColor: theme.colors.text,
        dirColor: colors.accent ?? theme.colors.primary,
        connectorColor: withAlpha(theme.colors.text, 0.25),
        iconColor: colors.accent ?? theme.colors.primary,
        commentColor: theme.colors.textMuted,
        fontSize: rowFontSize,
        fontFamily: getThemeFont(context, 'body'),
        monoFontFamily: getThemeFont(context, 'mono'),
        indentPx: Math.round(rowFontSize * 1.4),
      },
    },
    position: {
      x: '10%',
      y: `${8 + titleBandPct}%`,
      width: '80%',
      height: `${Math.max(60, 90 - titleBandPct)}%`,
    },
    animation: { type: 'fadeIn', duration: 1, delay: input.title ? 0.4 : 0 },
  });

  return layers;
}
