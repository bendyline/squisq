/**
 * Title Block Template
 *
 * Large title with optional subtitle for doc intros.
 * Centered text with fade-in animations, composed as one lockup:
 * accent rule, title, and subtitle are spaced from the title's
 * estimated height instead of fixed slots that collide on wrap.
 * Adapts font sizes and positioning for different viewports.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { TitleBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { getThemeFont, shouldUseShadow, themedFontSize } from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { estimateTextHeight } from './captionUtils.js';

/**
 * Hint schema published for the theme validator + future customizer hint UI.
 * Themes may set `templateHints.title` entries matching these keys.
 */
export const titleBlockHintSchema = {
  /** Whether to render a thin accent line above the title. Default: theme-dependent. */
  showAccentLine: { type: 'boolean' as const, default: true },
} as const;

export function titleBlock(input: TitleBlockInput, context: TemplateContext): Layer[] {
  const { title, subtitle, backgroundColor } = input;
  const { theme, layout, viewport } = context;

  // Scale font sizes for viewport
  const titleFontSize = themedFontSize(96, context, true);
  const subtitleFontSize = themedFontSize(36, context, false);

  const baseBg = backgroundColor || theme.colors.primary;

  // Estimate the title's rendered height so the rule and subtitle key off
  // its real extent — fixed slots let the rule overlap the ascenders and
  // stranded the subtitle when the title wrapped.
  const maxWidthPx = (parseFloat(layout.maxTextWidth) / 100) * viewport.width;
  const titleH = estimateTextHeight(title, titleFontSize, maxWidthPx, 1.15);
  const titleYPct = subtitle ? 42 : 48;
  const px = (v: number) => (v / viewport.height) * 100;

  const layers: Layer[] = [
    // Background — theme surface with a soft radial accent tint. The tint
    // is translucent so the theme's text color keeps its contrast with the
    // surface; a full-strength `primary` hotspot behind the title made
    // dark-primary light themes unreadable.
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: theme.colors.background,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
    {
      type: 'shape',
      id: 'bg-tint',
      content: {
        shape: 'rect',
        fill: `radial-gradient(ellipse at 50% 40%, ${withAlpha(baseBg, 0.32)} 0%, ${withAlpha(baseBg, 0)} 75%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
    // Subtle decorative line, clear above the title's ascenders
    {
      type: 'shape',
      id: 'accent-line',
      content: {
        shape: 'rect',
        fill: withAlpha(theme.colors.text, 0.3),
      },
      position: {
        x: '44%',
        y: `${titleYPct - px(titleH / 2 + 56)}%`,
        width: '12%',
        height: '3px',
      },
    },
    // Title
    {
      type: 'text',
      id: 'title',
      content: {
        text: title,
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: '50%',
        y: `${titleYPct}%`,
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 2 },
    },
  ];

  // Add subtitle if provided — hangs from the title's estimated bottom edge
  if (subtitle) {
    const subH = estimateTextHeight(subtitle, subtitleFontSize, maxWidthPx, 1.5);
    layers.push({
      type: 'text',
      id: 'subtitle',
      content: {
        text: subtitle,
        style: {
          fontSize: subtitleFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: 1.5,
        },
      },
      position: {
        x: '50%',
        y: `${titleYPct + px(titleH / 2 + 56 + subH / 2)}%`,
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 1.5, delay: 1 },
    });
  }

  return layers;
}
