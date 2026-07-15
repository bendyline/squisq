import { describe, expect, it, vi } from 'vitest';
import { THEMES } from '@bendyline/squisq/schemas';
import { createMermaidThemeStore } from '../mermaidThemeStore';

describe('Mermaid theme store', () => {
  it('notifies separately mounted widgets when the active theme changes', () => {
    const store = createMermaidThemeStore(THEMES.standard);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setTheme(THEMES.magazine);
    expect(store.getSnapshot()).toBe(THEMES.magazine);
    expect(listener).toHaveBeenCalledOnce();

    store.setTheme(THEMES.magazine);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    store.setTheme(THEMES.minimalist);
    expect(listener).toHaveBeenCalledOnce();
  });
});
