import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The chrome palette is only a theming seam if every chrome color actually
 * goes through it. A literal that creeps back into a stylesheet is invisible
 * until a host wonders why one button stayed blue — which is exactly how the
 * editor accumulated an indigo family beside a blue one, and a slate ramp
 * beside a gray one, before styles/chrome.css existed.
 */
const STYLE_ROOT = join(process.cwd(), 'packages/editor-react/src');
const CHROME = join(STYLE_ROOT, 'styles/chrome.css');

/**
 * Files allowed to name colors directly, and why. Add to this list only with
 * a reason that survives "the host wants its own palette here".
 */
const EXEMPT: Record<string, string> = {
  'imageEditor/image-editor.css':
    'a dark room in both themes — a photo is judged against a neutral dark field',
};

function cssFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, acc);
    else if (entry.endsWith('.css')) acc.push(full);
  }
  return acc;
}

/** Strip comments and the document-theme fallbacks, which are not chrome. */
function chromeDeclarations(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/var\(\s*--squisq-(theme|page|write|prompter)-[a-z-]+\s*,[^)]*\)/g, '');
}

describe('chrome palette', () => {
  const files = cssFiles(STYLE_ROOT).filter((f) => f !== CHROME);

  it.each(files.map((f) => [f.slice(STYLE_ROOT.length + 1).replace(/\\/g, '/'), f]))(
    '%s names no colors of its own',
    (rel, full) => {
      if (EXEMPT[rel]) return;
      const literals = chromeDeclarations(readFileSync(full, 'utf8')).match(
        /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g,
      );
      expect(literals ?? [], `${rel} should use --squisq-* tokens, not literal colors`).toEqual([]);
    },
  );

  it('gives every token a value in both themes, or deliberately in neither', () => {
    const css = readFileSync(CHROME, 'utf8');
    const block = (selector: string) => {
      const at = css.indexOf(selector);
      const open = css.indexOf('{', at);
      return css.slice(open, css.indexOf('\n}', open));
    };
    const names = (text: string) =>
      new Set([...text.matchAll(/^\s*(--squisq-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

    const light = names(block(":where(:root),\n:where([data-theme='light'])"));
    const dark = names(block(":where([data-theme='dark'])"));

    // Tokens that hold the same value in both themes on purpose. A find
    // highlight is a marker pen on the text: a reader scanning for the next
    // match should not have to relearn its color when the app flips theme.
    const intentionallyShared = new Set([
      '--squisq-find-match',
      '--squisq-find-match-current',
      '--squisq-find-match-ring',
      '--squisq-find-match-text',
      '--squisq-focus-ring',
      '--squisq-clip-audio',
      '--squisq-clip-video',
      '--squisq-clip-video-strip',
      '--squisq-text-on-clip',
      '--squisq-media-well',
      '--squisq-success-border',
    ]);

    const lightOnly = [...light].filter((n) => !dark.has(n) && !intentionallyShared.has(n));
    expect(lightOnly, 'declared for light but never rebound for dark').toEqual([]);
    expect(
      [...dark].filter((n) => !light.has(n)),
      'declared for dark but not for light',
    ).toEqual([]);
  });
});
