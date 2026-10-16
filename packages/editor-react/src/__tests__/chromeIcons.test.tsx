import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHROME_ICONS, chromeIconFor } from '../chromeIcons';
import { Icon } from '../Icon';

/**
 * The chrome draws one icon family at one stroke weight. That only holds while
 * every glyph the chrome names has a Lucide counterpart — an unmapped name
 * silently falls back to the solid Font Awesome webfont, and a filled glyph
 * reappears beside the outlines.
 */
const SRC = join(process.cwd(), 'packages/editor-react/src');

/**
 * Files whose Font Awesome names are document content, not chrome, and why.
 * Those glyphs are part of what the author wrote, so they keep the webfont.
 */
const CONTENT: Record<string, string> = {
  'InlineIcon.ts': 'renders inline {[icon]} nodes from the document',
  'EmojiPicker.tsx': 'the picker inserts Font Awesome glyphs into the document',
  'tiptapBridge.ts': 'round-trips inline icon nodes through markdown',
  'utils/collectInlineFontAwesomeCss.ts': 'inlines the webfont for exported content icons',
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('chrome icons', () => {
  it('maps every Font Awesome glyph the chrome names to a Lucide outline', () => {
    const unmapped: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (CONTENT[rel]) continue;
      const source = readFileSync(file, 'utf8');
      for (const [, style, name] of source.matchAll(/fa-(solid|regular) fa-([a-z0-9-]+)/g)) {
        if (!CHROME_ICONS[name!]) unmapped.push(`${rel}: fa-${style} fa-${name}`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('resolves Font Awesome class strings, modifiers and bare glyph names', () => {
    expect(chromeIconFor('fa-solid fa-bold')).toBe(CHROME_ICONS.bold);
    expect(chromeIconFor('fa-regular fa-folder fa-fw')).toBe(CHROME_ICONS.folder);
    expect(chromeIconFor('layout-template')).toBe(CHROME_ICONS['layout-template']);
  });

  it('leaves brand marks and unknown names to Font Awesome', () => {
    expect(chromeIconFor('fa-brands fa-github')).toBeUndefined();
    expect(chromeIconFor('fa-solid fa-not-a-real-glyph')).toBeUndefined();
  });

  it('draws a mapped glyph as a decorative outline that carries its classes', () => {
    const { container } = render(<Icon icon="fa-solid fa-bold" className="extra" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.classList.contains('squisq-icon')).toBe(true);
    expect(svg!.classList.contains('extra')).toBe(true);
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('i')).toBeNull();
  });

  it('falls back to the webfont element for a brand mark', () => {
    const { container } = render(<Icon icon="fa-brands fa-github" />);
    const glyph = container.querySelector('i');
    expect(glyph?.className).toBe('fa-brands fa-github');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('svg')).toBeNull();
  });
});
