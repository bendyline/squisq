import { afterEach, describe, expect, it } from 'vitest';
import { buildMermaidThemeVariables, THEMES } from '@bendyline/squisq/schemas';
import {
  adaptThemeToSurface,
  mermaidSurfaceScheme,
  resolveMermaidSurfaceTheme,
} from '../mermaidSurfaceTheme';

function mountHost(shellTheme: 'light' | 'dark', inheritance: string): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'squisq-editor-shell';
  shell.dataset.theme = shellTheme;
  const container = document.createElement('div');
  container.className = 'squisq-wysiwyg-container';
  container.dataset.themeInheritance = inheritance;
  const host = document.createElement('div');
  shell.append(container);
  container.append(host);
  document.body.append(shell);
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Mermaid surface theme', () => {
  it('renders a light document theme against the dark editor canvas', () => {
    const host = mountHost('dark', 'fonts');
    const resolved = resolveMermaidSurfaceTheme(host, THEMES.standard);

    expect(mermaidSurfaceScheme(resolved)).toBe('dark');
    expect(mermaidSurfaceScheme(THEMES.standard)).toBe('light');
    expect(buildMermaidThemeVariables(resolved).darkMode).toBe(true);
  });

  it('keeps the document theme when the canvas inherits its colors', () => {
    const host = mountHost('dark', 'fonts-colors');
    expect(resolveMermaidSurfaceTheme(host, THEMES.standard)).toBe(THEMES.standard);
  });

  it('leaves accent slots to the document theme', () => {
    const { colors } = adaptThemeToSurface(THEMES.standard, 'dark');
    expect(colors.primary).toBe(THEMES.standard.colors.primary);
    expect(colors.secondary).toBe(THEMES.standard.colors.secondary);
    expect(colors.highlight).toBe(THEMES.standard.colors.highlight);
    expect(colors.warning).toBe(THEMES.standard.colors.warning);
    expect(colors.background).not.toBe(THEMES.standard.colors.background);
  });

  it('falls back to the light surface outside a themed shell', () => {
    const host = document.createElement('div');
    document.body.append(host);
    expect(mermaidSurfaceScheme(resolveMermaidSurfaceTheme(host, THEMES.standard))).toBe('light');
  });
});
