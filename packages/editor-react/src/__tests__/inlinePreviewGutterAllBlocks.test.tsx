import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EditorProvider } from '../EditorContext';
import { InlinePreviewGutter } from '../InlinePreviewGutter';

// jsdom lacks ResizeObserver — the gutter wires one up to recompute on
// editor resizes. Stub a no-op for the tests that don't need real
// observations.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

/**
 * The all-blocks vertical-line rendering needs a sibling `.squisq-wysiwyg-container`
 * with real heading elements for the layout effect's MutationObserver +
 * `getBoundingClientRect()` reads to find anything. In the production app
 * this is provided by `<WysiwygEditor>`. Here we hand-roll a stub that
 * mounts the heading DOM the gutter expects to query.
 */
function renderWithStubEditor(html: string) {
  return render(
    <EditorProvider initialMarkdown="" initialView="wysiwyg" articleId="test">
      <div className="squisq-wysiwyg-with-gutter" style={{ position: 'relative', height: 600 }}>
        <div
          className="squisq-wysiwyg-container"
          style={{ position: 'relative', width: 800, height: 600 }}
        >
          <div className="squisq-wysiwyg-editor" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <InlinePreviewGutter />
      </div>
    </EditorProvider>,
  );
}

describe('InlinePreviewGutter — all-block bracket lines', () => {
  it('renders a vertical-extent bar per heading even when none are annotated', async () => {
    const { container } = renderWithStubEditor(
      '<h1>Hello World</h1>' +
        '<p>Body</p>' +
        '<h2>Getting Started</h2>' +
        '<p>Body</p>' +
        '<h2>Tips</h2>' +
        '<p>Body</p>',
    );

    await waitFor(
      () => {
        const bars = container.querySelectorAll('.squisq-inline-preview-extent');
        expect(bars.length).toBe(3);
      },
      { timeout: 1000 },
    );

    // All three should be the untagged variant (no `data-template` on any).
    const bars = container.querySelectorAll('.squisq-inline-preview-extent');
    bars.forEach((bar) =>
      expect(bar.classList.contains('squisq-inline-preview-extent--untagged')).toBe(true),
    );
  });

  it('renders a strong tagged bar for annotated headings + lighter bars for the rest', async () => {
    const { container } = renderWithStubEditor(
      '<h1>Welcome</h1>' +
        '<h2 data-template="sectionHeader">Getting Started</h2>' +
        '<h2>Tips</h2>',
    );

    await waitFor(
      () => {
        const bars = container.querySelectorAll('.squisq-inline-preview-extent');
        expect(bars.length).toBe(3);
      },
      { timeout: 1000 },
    );

    const bars = Array.from(container.querySelectorAll('.squisq-inline-preview-extent'));
    const tagged = bars.filter(
      (b) => !b.classList.contains('squisq-inline-preview-extent--untagged'),
    );
    const untagged = bars.filter((b) =>
      b.classList.contains('squisq-inline-preview-extent--untagged'),
    );
    expect(tagged.length).toBe(1);
    expect(untagged.length).toBe(2);
  });
});

// Suppress ResolvePackageJsonExportsLogic pollution in the JSDOM globals — noop.
// The screen import is unused but kept to mirror the sibling test file's style.
void screen;
