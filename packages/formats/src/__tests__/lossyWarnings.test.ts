/**
 * Tests for the registry's consolidated lossy-path warnings, all surfaced
 * through `ConversionResult.warnings`:
 *  - xlsx export drops non-table content (tables-only fidelity)
 *  - PDF import does not report the retired Node/canvas degradation
 *  - transform → markdown produces blocks that don't round-trip
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { convert, defaultRegistry } from '../registry/index';

// ── shared Markdown exporter capability profiles ───────────────────

describe('Markdown exporters warn about unsupported AST extensions', () => {
  const extendedMarkdown: MarkdownDocument = {
    type: 'document',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Assigned to ' },
          {
            type: 'mention',
            targetKind: 'user',
            targetId: '42',
            displayName: 'Ada',
          },
        ],
      },
      {
        type: 'containerDirective',
        name: 'note',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Important' }] }],
      },
    ],
  };

  it('surfaces the omitted node types through ConversionResult', async () => {
    const result = await convert({ kind: 'markdown', markdown: extendedMarkdown }, 'docx');
    const warning = result.warnings.find((item) => /unsupported Markdown node/i.test(item));

    expect(warning).toMatch(/mention \(1\)/);
    expect(warning).toMatch(/containerDirective \(1\)/);
  });

  it('does not warn for the supported Markdown subset', async () => {
    const result = await convert({ kind: 'markdown', markdown: '# Title\n\nBody.' }, 'docx');
    expect(result.warnings.some((item) => /unsupported Markdown node/i.test(item))).toBe(false);
  });
});

// ── xlsx: tables-only fidelity ──────────────────────────────────────

describe('xlsx export warns about omitted non-table content', () => {
  it('warns when prose / lists accompany the table(s)', async () => {
    const md =
      '# Report\n\nIntro prose paragraph.\n\n- a\n- b\n\n| A | B |\n| - | - |\n| 1 | 2 |\n';
    const result = await convert({ kind: 'markdown', markdown: md }, 'xlsx');
    expect(result.warnings.some((w) => /tables-only/i.test(w))).toBe(true);
    // Two omitted blocks: the paragraph and the list (heading names the sheet).
    expect(result.warnings.find((w) => /tables-only/i.test(w))).toMatch(/2 non-table block/);
  });

  it('does not warn for a heading + table only document', async () => {
    const md = '# Sales\n\n| A |\n| - |\n| x |\n';
    const result = await convert({ kind: 'markdown', markdown: md }, 'xlsx');
    expect(result.warnings.some((w) => /tables-only/i.test(w))).toBe(false);
  });
});

// ── pdf: Node image extraction no longer depends on DOM canvas ─────

describe('pdf import warning behavior across runtimes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A pdf definition whose importContainer is stubbed (avoids pdfjs/canvas). */
  function registryWithStubPdf() {
    const registry = defaultRegistry();
    registry.register({
      ...registry.get('pdf')!,
      async importContainer() {
        const c = new MemoryContentContainer();
        await c.writeDocument('# From PDF\n\nBody.');
        return c;
      },
    });
    return registry;
  }

  const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%mock\n');

  it('does not report skipped images when document is undefined', async () => {
    vi.stubGlobal('document', undefined);
    const registry = registryWithStubPdf();
    const result = await convert({ kind: 'bytes', data: pdfBytes, filename: 'x.pdf' }, 'md', {
      from: 'pdf',
      registry,
    });
    expect(result.warnings.some((w) => /embedded images were skipped/i.test(w))).toBe(false);
  });

  it('does not warn when a DOM is present (jsdom default)', async () => {
    const registry = registryWithStubPdf();
    const result = await convert({ kind: 'bytes', data: pdfBytes, filename: 'x.pdf' }, 'md', {
      from: 'pdf',
      registry,
    });
    expect(result.warnings.some((w) => /embedded images were skipped/i.test(w))).toBe(false);
  });
});

// ── transform → markdown round-trip loss ────────────────────────────

describe('transform-to-markdown export warns about non-round-tripping blocks', () => {
  const CONTENT_MD = `# Big Title

An intro paragraph with plenty of words so the transform has real content.

## Numbers

Revenue grew by 45% last quarter across every region and product line worldwide.

- Point one with several words to analyze here
- Point two with several words to analyze here

| Metric | Value |
| - | - |
| Users | 1000 |
`;

  it('warns when a transform reshapes into template blocks that markdown can’t hold', async () => {
    const result = await convert({ kind: 'markdown', markdown: CONTENT_MD }, 'md', {
      transformStyle: 'magazine',
    });
    expect(result.warnings.some((w) => /round-trip to markdown/i.test(w))).toBe(true);
  });

  it('does not warn without a transform', async () => {
    const result = await convert({ kind: 'markdown', markdown: CONTENT_MD }, 'md');
    expect(result.warnings.some((w) => /round-trip to markdown/i.test(w))).toBe(false);
  });
});
