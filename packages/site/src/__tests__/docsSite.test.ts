import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEMPLATE_METADATA } from '@bendyline/squisq/doc';
import { buildDocsSite, type DocsSiteBuild } from '../docsSite/buildDocsSite';
import { highlightEscapedCode, escapeHtml } from '../docsSite/highlight';
import { githubSlug, Slugger } from '../docsSite/markdownTools';
import { nodeDocsSource } from '../docsSite/nodeDocsSource';
import { decodeSharedMarkdown, encodeSharedMarkdown } from '../sharedMarkdown';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let cached: DocsSiteBuild | null = null;
function site(): DocsSiteBuild {
  if (!cached) throw new Error('docs site not built');
  return cached;
}

function text(file: string | Uint8Array | undefined): string {
  if (file === undefined) throw new Error('missing file');
  return typeof file === 'string' ? file : new TextDecoder().decode(file);
}

describe('documentation site', () => {
  // Building every page (and converting every live example) takes ~2.7 s on
  // its own and ~6 s under coverage — past the 5 s default before a saturated
  // full-suite run slows it further. Build once here, so no single test is
  // charged for it, under a timeout that covers the build.
  beforeAll(() => {
    cached = buildDocsSite({ source: nodeDocsSource(repoDir) });
  }, 60_000);

  it('builds with no broken links, missing anchors, or failed examples', () => {
    expect(site().problems).toEqual([]);
  });

  it('has a gallery page with a live example for every built-in template', () => {
    for (const id of Object.keys(TEMPLATE_METADATA)) {
      const page = site().pages.find((candidate) => candidate.path === `blocks/${id}.html`);
      expect(page, `blocks/${id}.md`).toBeDefined();
      expect(page!.previews, `blocks/${id}.md has no live example`).toBeGreaterThan(0);
    }
  });

  it('publishes no placeholder pages', () => {
    for (const page of site().pages) {
      expect(text(site().files.get(page.path)), page.source).not.toMatch(/\bSTUB\b|\bTODO\b/);
    }
  });

  it('places every page in the page template with navigation and a title', () => {
    for (const page of site().pages) {
      const html = text(site().files.get(page.path));
      expect(html, page.path).toContain('<!-- squisq:content -->');
      expect(html, page.path).not.toContain('<!--docs:');
      expect(html, page.path).not.toContain('squisq-docs-root:');
      expect(html, page.path).not.toContain('@@squisq-docs-');
      expect(html, page.path).toMatch(/<title>[^<]+<\/title>/);
    }
  });

  it('writes a search index covering every page', () => {
    const index = JSON.parse(text(site().files.get('_theme/search-index.json'))) as Array<{
      u: string;
    }>;
    expect(index.map((entry) => entry.u).sort()).toEqual(
      site()
        .pages.map((page) => page.path)
        .sort(),
    );
  });
});

describe('docs helpers', () => {
  it('slugs headings the way GitHub does', () => {
    expect(githubSlug('`@bendyline/squisq` (Core)')).toBe('bendylinesquisq-core');
    expect(githubSlug('Images & video')).toBe('images--video');
    const slugger = new Slugger();
    expect([slugger.slug('Hooks'), slugger.slug('Hooks'), slugger.slug('Hooks')]).toEqual([
      'hooks',
      'hooks-1',
      'hooks-2',
    ]);
  });

  it('highlights code without changing its text', () => {
    const samples: Array<[string, string]> = [
      [
        'markdown',
        '---\ntitle: A & B\n---\n\n## Hi {[quote attribution="Ada <L>"]}\n\n```\n<x>\n```',
      ],
      [
        'tsx',
        "import { DocPlayer } from '@bendyline/squisq-react';\n// a < b\n<DocPlayer doc={d} />",
      ],
      ['bash', 'npx squisq convert doc.md --formats docx,pdf # "quoted"'],
      ['json', '{ "a": [1, true, null], "b": "x<y" }'],
      ['html', '<!-- c --><slot name="title">Hi &amp; bye</slot>'],
    ];
    for (const [lang, code] of samples) {
      const highlighted = highlightEscapedCode(escapeHtml(code), lang);
      const plain = highlighted.replace(/<[^>]+>/g, '');
      expect(plain, lang).toBe(escapeHtml(code));
    }
  });

  it('round-trips markdown through an editor link', () => {
    const markdown = '# Café ☕\n\n## Quote {[quote]}\n\n> “Hi” — 漢字';
    expect(decodeSharedMarkdown(encodeSharedMarkdown(markdown))).toBe(markdown);
    expect(decodeSharedMarkdown('#sample=1')).toBeNull();
    expect(decodeSharedMarkdown('#md=%%%')).toBeNull();
  });
});
