/**
 * Title Block Template
 *
 * Large title with optional subtitle for doc intros.
 * Centered text with fade-in animations.
 * Adapts font sizes and positioning for different viewports.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { TitleBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { getThemeFont } from '../utils/themeUtils.js';

/**
 * Hint schema published for the theme validator + future customizer hint UI.
 * Themes may set `templateHints.titleBlock` entries matching these keys.
 */
export const titleBlockHintSchema = {
  /** Whether to render a thin accent line above the title. Default: theme-dependent. */
  showAccentLine: { type: 'boolean' as const, default: true },
} as const;

export function titleBlock(input: TitleBlockInput, context: TemplateContext): Layer[] {
  const { title, subtitle, backgroundColor } = input;
  const { theme, layout } = context;

  // Scale font sizes for viewport
  const titleFontSize = scaledFontSize(96, context, true);
  const subtitleFontSize = scaledFontSize(36, context, false);

  const baseBg = backgroundColor || theme.colors.primary;

  const layers: Layer[] = [
    // Background — radial gradient for depth instead of flat color
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `radial-gradient(ellipse at 50% 40%, ${baseBg} 0%, ${theme.colors.background} 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
    // Subtle decorative line above title
    {
      type: 'shape',
      id: 'accent-line',
      content: {
        shape: 'rect',
        fill: 'rgba(255, 255, 255, 0.2)',
      },
      position: {
        x: '40%',
        y: subtitle ? '28%' : '38%',
        width: '20%',
        height: '2px',
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
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: subtitle ? layout.primaryY : '50%',
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 2 },
    },
  ];

  // Add subtitle if provided
  if (subtitle) {
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
        y: layout.secondaryY,
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 1.5, delay: 1 },
    });
  }

  return layers;
}
