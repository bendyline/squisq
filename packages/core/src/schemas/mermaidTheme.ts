/**
 * Translate a Squisq Theme into Mermaid's `themeVariables` vocabulary.
 *
 * This module deliberately has no Mermaid dependency. Both the editor and
 * read-only React renderers use the returned plain object immediately before
 * their queued Mermaid render, keeping the two surfaces visually identical.
 */

import type { Theme } from './Theme.js';
import { pickContrastingText, relativeLuminance } from './colorUtils.js';
import { FONT_FALLBACKS, resolveFontFamily } from './fontStacks.js';

export type MermaidThemeVariables = Record<string, string | number | boolean>;

const MERMAID_CHART_COLOR_COUNT = 12;

function uniqueColors(colors: readonly string[]): string[] {
  return colors.filter((color, index) => color && colors.indexOf(color) === index);
}

function chartPalette(theme: Theme): string[] {
  const schemes = Object.values(theme.colorSchemes);
  const seeds = uniqueColors([
    theme.colors.primary,
    theme.colors.secondary,
    theme.colors.highlight,
    ...schemes.map((scheme) => scheme.accent),
    theme.colors.warning,
    ...schemes.map((scheme) => scheme.bg),
    theme.colors.textMuted,
    theme.colors.backgroundLight,
  ]);
  const fallback = theme.colors.primary;
  return Array.from(
    { length: MERMAID_CHART_COLOR_COUNT },
    (_, index) => seeds[index % Math.max(1, seeds.length)] ?? fallback,
  );
}

function textOn(theme: Theme, background: string): string {
  return pickContrastingText(background, theme.colors.text, theme.colors.background);
}

/** Build complete, contrast-aware Mermaid theme variables from a Squisq theme. */
export function buildMermaidThemeVariables(theme: Theme): MermaidThemeVariables {
  const { colors } = theme;
  const primaryText = textOn(theme, colors.primary);
  const secondaryText = textOn(theme, colors.secondary);
  const highlightText = textOn(theme, colors.highlight);
  const palette = chartPalette(theme);
  const variables: MermaidThemeVariables = {
    darkMode: relativeLuminance(colors.background) < 0.5,
    background: colors.background,
    fontFamily: resolveFontFamily(theme.typography.bodyFont, FONT_FALLBACKS.sans),

    primaryColor: colors.primary,
    primaryTextColor: primaryText,
    primaryBorderColor: colors.highlight,
    secondaryColor: colors.secondary,
    secondaryTextColor: secondaryText,
    secondaryBorderColor: colors.primary,
    tertiaryColor: colors.backgroundLight,
    tertiaryTextColor: colors.text,
    tertiaryBorderColor: colors.textMuted,

    textColor: colors.text,
    titleColor: colors.text,
    lineColor: colors.textMuted,
    arrowheadColor: colors.textMuted,
    defaultLinkColor: colors.textMuted,
    mainBkg: colors.primary,
    nodeBkg: colors.primary,
    nodeTextColor: primaryText,
    nodeBorder: colors.highlight,
    clusterBkg: colors.backgroundLight,
    clusterBorder: colors.secondary,
    edgeLabelBackground: colors.background,

    actorBkg: colors.backgroundLight,
    actorBorder: colors.primary,
    actorTextColor: colors.text,
    actorLineColor: colors.textMuted,
    signalColor: colors.textMuted,
    signalTextColor: colors.text,
    labelBoxBkgColor: colors.backgroundLight,
    labelBoxBorderColor: colors.secondary,
    labelTextColor: colors.text,
    loopTextColor: colors.text,
    activationBkgColor: colors.secondary,
    activationBorderColor: colors.primary,
    sequenceNumberColor: primaryText,

    noteBkgColor: colors.highlight,
    noteBorderColor: colors.primary,
    noteTextColor: highlightText,
    sectionBkgColor: colors.backgroundLight,
    altSectionBkgColor: colors.background,
    sectionBkgColor2: colors.primary,
    taskBkgColor: colors.primary,
    taskBorderColor: colors.highlight,
    taskTextColor: primaryText,
    taskTextLightColor: colors.text,
    taskTextDarkColor: colors.text,
    taskTextOutsideColor: colors.text,
    taskTextClickableColor: colors.highlight,
    activeTaskBkgColor: colors.secondary,
    activeTaskBorderColor: colors.highlight,
    doneTaskBkgColor: colors.backgroundLight,
    doneTaskBorderColor: colors.textMuted,
    critBkgColor: colors.warning,
    critBorderColor: colors.highlight,
    todayLineColor: colors.warning,
    gridColor: colors.textMuted,

    pieTitleTextColor: colors.text,
    pieSectionTextColor: colors.text,
    pieLegendTextColor: colors.text,
    pieStrokeColor: colors.background,
    pieOuterStrokeColor: colors.textMuted,
    quadrantPointFill: colors.highlight,
    quadrantPointTextFill: highlightText,
    quadrantXAxisTextFill: colors.text,
    quadrantYAxisTextFill: colors.text,
    quadrantTitleFill: colors.text,
    requirementBackground: colors.backgroundLight,
    requirementBorderColor: colors.primary,
    requirementTextColor: colors.text,
    relationColor: colors.textMuted,
    relationLabelBackground: colors.background,
    relationLabelColor: colors.text,
    commitLabelColor: colors.text,
    commitLabelBackground: colors.backgroundLight,
    tagLabelColor: primaryText,
    tagLabelBackground: colors.primary,
    tagLabelBorder: colors.highlight,
  };

  palette.forEach((color, index) => {
    const label = textOn(theme, color);
    variables[`cScale${index}`] = color;
    variables[`cScaleInv${index}`] = label;
    variables[`cScaleLabel${index}`] = label;
    variables[`cScalePeer${index}`] = label;
    variables[`pie${index + 1}`] = color;
    if (index < 8) {
      variables[`git${index}`] = color;
      variables[`gitInv${index}`] = label;
      variables[`gitBranchLabel${index}`] = label;
    }
  });

  return variables;
}
