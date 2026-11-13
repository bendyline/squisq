import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../schemas/colorUtils';
import { buildMermaidThemeCss, buildMermaidThemeVariables } from '../schemas/mermaidTheme';
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

describe('buildMermaidThemeCss', () => {
  /** The color the stylesheet gives `property` in the rule that names `selector`. */
  function ruleColor(css: string, selector: string, property: 'color' | 'fill'): string {
    const rule = css.split('\n').find((line) => line.split('{')[0]?.includes(selector));
    return new RegExp(`\\b${property}: ([^;]+);`).exec(rule ?? '')?.[1] ?? '';
  }

  it('gives labels that sit on the page a color that reads on it, in every theme', () => {
    for (const theme of Object.values(BUILTIN_THEMES)) {
      const css = buildMermaidThemeCss(theme);
      const page = String(buildMermaidThemeVariables(theme).edgeLabelBackground);
      // HTML labels are spans; SVG-text labels (exported pictures) are text elements.
      const colors = [
        ruleColor(css, '.edgeLabel span', 'color'),
        ruleColor(css, '.edgeLabel text', 'fill'),
        ruleColor(css, '.icon-shape .label span', 'color'),
        ruleColor(css, '.image-shape .label text', 'fill'),
      ];
      for (const color of colors) {
        expect(contrastRatio(color, page), `${theme.id}: ${color} on ${page}`).toBeGreaterThan(4.5);
      }
    }
  });

  it('covers a theme whose node text color is the page color', () => {
    // The bug this stylesheet exists for: Mermaid paints every flowchart label
    // with `nodeTextColor`, which is white on the Standard theme's white page.
    const theme = BUILTIN_THEMES.standard;
    const variables = buildMermaidThemeVariables(theme);
    expect(variables.nodeTextColor).toBe(variables.edgeLabelBackground);
    expect(ruleColor(buildMermaidThemeCss(theme), '.edgeLabel span', 'color')).toBe(
      theme.colors.text,
    );
  });

  it('leaves a color the author or the host sets in charge', () => {
    const css = buildMermaidThemeCss(BUILTIN_THEMES.standard);
    expect(css).not.toContain('!important');
    // `linkStyle 0 color:red` is written inline on the label's span or text and
    // inherited by the p or tspan inside it, so no rule may name those.
    expect(css).not.toMatch(/\b(p|tspan)\s*[,{]/);
    // The picture an icon node draws is not its caption.
    expect(css).not.toMatch(/\.icon-shape (span|text)/);
  });

  it('writes nothing for a color that could end the declaration', () => {
    const { standard } = BUILTIN_THEMES;
    const withText = (text: string) => ({ ...standard, colors: { ...standard.colors, text } });
    expect(buildMermaidThemeCss(withText('red; } * { display: none'))).toBe('');
    expect(buildMermaidThemeCss(withText('rgb(15 23 42 / 90%)'))).toContain(
      'color: rgb(15 23 42 / 90%);',
    );
  });
});
