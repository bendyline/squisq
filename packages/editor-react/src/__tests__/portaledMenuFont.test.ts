import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Menus and popovers that portal onto <body> sit outside
 * `.squisq-editor-shell`, so they inherit the HOST page's font instead of the
 * chrome face — the browser's default serif when the host sets none. That is
 * how the proofing menu and its hover card came to render in Times beside a
 * right-click menu set in the host's UI font. Each portaled root has to name
 * `--squisq-ux-font` itself.
 */
const PORTALED_MENUS = [
  'squisq-editor-context-menu',
  'squisq-proof-menu',
  'squisq-proof-tooltip',
  'squisq-insert-menu',
  'squisq-toolbar-overflow-menu',
  'squisq-block-props-popover',
  'squisq-theme-picker-popover',
  'squisq-transition-flyout',
  'squisq-view-menu-popover',
  'squisq-timeline-item-menu',
  'squisq-use-mode-menu',
  'squisq-cover-slide-menu',
  'squisq-mention-popover',
  'squisq-tooltip',
];

const STYLE_ROOT = join(process.cwd(), 'packages/editor-react/src');
const UX_FONT = /\bfont(?:-family)?\s*:[^;]*var\(\s*--squisq-ux-font\b/;

function cssFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, acc);
    else if (entry.endsWith('.css')) acc.push(full);
  }
  return acc;
}

/** Every rule whose selector list names `.cls` on its own, across all sheets. */
function bareRules(): Map<string, string[]> {
  const bodies = new Map<string, string[]>();
  for (const file of cssFiles(STYLE_ROOT)) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(',')) {
        const bare = /^\.([a-z0-9-]+)$/.exec(selector.trim());
        if (bare) bodies.set(bare[1], [...(bodies.get(bare[1]) ?? []), body]);
      }
    }
  }
  return bodies;
}

describe('portaled menu font', () => {
  const rules = bareRules();

  it.each(PORTALED_MENUS)('.%s sets the chrome face', (cls) => {
    const bodies = rules.get(cls) ?? [];
    expect(bodies.length, `no bare .${cls} rule found`).toBeGreaterThan(0);
    expect(
      bodies.some((body) => UX_FONT.test(body)),
      `.${cls} portals onto <body>; it must name var(--squisq-ux-font, …)`,
    ).toBe(true);
  });

  it('never gives a menu or popover a font stack of its own', () => {
    const drifted = [...rules]
      .filter(([cls]) => /-(?:menu|popover|flyout|tooltip)$/.test(cls))
      .filter(([, bodies]) =>
        bodies.some((body) => /\bfont-family\s*:/.test(body) && !UX_FONT.test(body)),
      )
      .map(([cls]) => cls);
    expect(drifted).toEqual([]);
  });
});
