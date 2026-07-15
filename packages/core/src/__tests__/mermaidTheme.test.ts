import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../schemas/colorUtils';
import { buildMermaidThemeVariables } from '../schemas/mermaidTheme';
import { BUILTIN_THEMES } from '../schemas/themes';

describe('buildMermaidThemeVariables', () => {
  it('maps the Magazine identity into Mermaid base and chart colors', () => {
    const theme = BUILTIN_THEMES.magazine;
    const variables = buildMermaidThemeVariables(theme);

    expect(variables).toMatchObject({
      darkMode: true,
      background: theme.colors.background,
      primaryColor: theme.colors.primary,
      secondaryColor: theme.colors.secondary,
      noteBkgColor: theme.colors.highlight,
      critBkgColor: theme.colors.warning,
      cScale0: theme.colors.primary,
      cScale1: theme.colors.secondary,
      cScale2: theme.colors.highlight,
    });
    expect(
      new Set(Array.from({ length: 12 }, (_, index) => variables[`cScale${index}`])).size,
    ).toBeGreaterThan(6);
  });

  it('chooses readable labels for every generated chart color', () => {
    for (const theme of Object.values(BUILTIN_THEMES)) {
      const variables = buildMermaidThemeVariables(theme);
      for (let index = 0; index < 12; index += 1) {
        const color = String(variables[`cScale${index}`]);
        const label = String(variables[`cScaleLabel${index}`]);
        const bestThemeContrast = Math.max(
          contrastRatio(color, theme.colors.text),
          contrastRatio(color, theme.colors.background),
        );
        expect(contrastRatio(color, label)).toBeCloseTo(bestThemeContrast, 6);
      }
    }
  });

  it('changes Mermaid variables when the active Squisq theme changes', () => {
    const magazine = buildMermaidThemeVariables(BUILTIN_THEMES.magazine);
    const minimalist = buildMermaidThemeVariables(BUILTIN_THEMES.minimalist);

    expect(magazine.primaryColor).not.toBe(minimalist.primaryColor);
    expect(magazine.background).not.toBe(minimalist.background);
    expect(magazine.fontFamily).not.toBe(minimalist.fontFamily);
  });
});
