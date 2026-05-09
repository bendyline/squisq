import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorProvider } from '../EditorContext';
import { OutlinePanel } from '../OutlinePanel';

// jsdom lacks ResizeObserver — the pane wires one up to track the editor's
// page edge. A no-op shim is enough for the rendering tests below.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

function renderOutline(markdown: string) {
  return render(
    <EditorProvider initialMarkdown={markdown} initialView="wysiwyg" articleId="test">
      <OutlinePanel />
    </EditorProvider>,
  );
}

describe('OutlinePanel', () => {
  it('renders the empty placeholder when the doc has no headings', async () => {
    renderOutline('Just a paragraph, no headings.\n');
    expect(await screen.findByText(/add a heading to populate the outline/i)).toBeTruthy();
  });

  it('renders one row per heading and nests by depth', async () => {
    const md = [
      '# Top Level',
      '',
      '## Subsection A',
      '',
      'Body.',
      '',
      '### Detail',
      '',
      'Body.',
      '',
      '## Subsection B',
      '',
      'Body.',
      '',
    ].join('\n');

    const { container } = renderOutline(md);
    await screen.findByTestId('outline-panel');

    const rows = container.querySelectorAll('.squisq-outline-row');
    expect(rows.length).toBe(4);

    // Depth modifier classes are applied per heading level.
    const depths = Array.from(rows).map((r) => {
      const match = r.className.match(/squisq-outline-row--depth-(\d)/);
      return match ? Number(match[1]) : null;
    });
    expect(depths).toEqual([1, 2, 3, 2]);

    // Heading text is reflected in row labels.
    const labels = Array.from(rows).map((r) => r.textContent?.trim());
    expect(labels).toContain('Top Level');
    expect(labels).toContain('Subsection A');
    expect(labels).toContain('Detail');
    expect(labels).toContain('Subsection B');
  });

  it('shows a template chip on annotated headings', async () => {
    const md = '# Welcome {[titleBlock]}\n\nIntro.\n';
    const { container } = renderOutline(md);
    await screen.findByTestId('outline-panel');
    const chip = container.querySelector('.squisq-outline-template-chip');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('Title Block');
  });
});
