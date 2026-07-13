import { describe, expect, it, beforeAll, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
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

function SourceProbe() {
  const { markdownSource } = useEditorContext();
  return <output data-testid="markdown-source">{markdownSource}</output>;
}

function renderOutlineWithSource(markdown: string, readOnly = false) {
  return render(
    <EditorProvider initialMarkdown={markdown} initialView="wysiwyg" articleId="test">
      <OutlinePanel readOnly={readOnly} />
      <SourceProbe />
    </EditorProvider>,
  );
}

function makeDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    getData: vi.fn((type: string) => values.get(type) ?? ''),
    get types() {
      return [...values.keys()];
    },
  } as unknown as DataTransfer;
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
    const md = '# Welcome {[title]}\n\nIntro.\n';
    const { container } = renderOutline(md);
    await screen.findByTestId('outline-panel');
    const chip = container.querySelector('.squisq-outline-template-chip');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('Title');
  });

  it('drags a section after a sibling and rewrites the underlying markdown', async () => {
    const source = '# Alpha\n\nalpha\n\n# Bravo\n\nbravo\n';
    const expected = '# Bravo\n\nbravo\n\n# Alpha\n\nalpha\n';
    const { container } = renderOutlineWithSource(source);
    const alpha = await screen.findByRole('button', { name: 'Alpha' });
    const bravo = await screen.findByRole('button', { name: 'Bravo' });
    const bravoWrap = bravo.closest<HTMLElement>('.squisq-outline-row-wrap');
    expect(bravoWrap).not.toBeNull();
    vi.spyOn(bravoWrap!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 200,
      bottom: 20,
      left: 0,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    });
    const transfer = makeDataTransfer();

    fireEvent.dragStart(alpha, { dataTransfer: transfer });
    expect(transfer.effectAllowed).toBe('move');
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', expect.any(String));

    fireEvent.dragOver(bravoWrap!, { dataTransfer: transfer, clientY: 18 });
    expect(transfer.dropEffect).toBe('move');
    expect(bravo.closest('.squisq-outline-item')?.classList).toContain(
      'squisq-outline-item--drop-after',
    );

    fireEvent.drop(bravoWrap!, { dataTransfer: transfer, clientY: 18 });
    expect(container.querySelector('.squisq-outline-item--drop-after')).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId('markdown-source').textContent).toBe(expected);
      const labels = Array.from(container.querySelectorAll('.squisq-outline-row-text')).map(
        (row) => row.textContent,
      );
      expect(labels).toEqual(['Bravo', 'Alpha']);
    });
  });

  it('disables outline mutations in read-only mode', async () => {
    const source = '# Alpha\n\nalpha\n\n# Bravo\n\nbravo\n';
    renderOutlineWithSource(source, true);
    const alpha = await screen.findByRole('button', { name: 'Alpha' });
    const bravo = await screen.findByRole('button', { name: 'Bravo' });
    const bravoWrap = bravo.closest<HTMLElement>('.squisq-outline-row-wrap');
    const transfer = makeDataTransfer();

    expect(alpha.getAttribute('draggable')).toBe('false');
    expect(
      screen
        .getAllByRole('button', { name: /demote heading \(currently h1\)/i })[0]
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.dragStart(alpha, { dataTransfer: transfer });
    fireEvent.drop(bravoWrap!, { dataTransfer: transfer, clientY: 100 });

    expect(screen.getByTestId('markdown-source').textContent).toBe(source);
  });
});
