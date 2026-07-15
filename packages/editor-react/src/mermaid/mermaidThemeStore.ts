import type { Theme } from '@bendyline/squisq/schemas';

export interface MermaidThemeStore {
  getSnapshot: () => Theme;
  subscribe: (listener: () => void) => () => void;
  setTheme: (theme: Theme) => void;
}

/**
 * Tiny external store that bridges the editor theme into Mermaid widgets.
 * Tiptap mounts each widget in its own React root, so ordinary React context
 * from `PreviewSettingsProvider` cannot cross that boundary.
 */
export function createMermaidThemeStore(initialTheme: Theme): MermaidThemeStore {
  let theme = initialTheme;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => theme,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTheme: (nextTheme) => {
      if (Object.is(theme, nextTheme)) return;
      theme = nextTheme;
      listeners.forEach((listener) => listener());
    },
  };
}
