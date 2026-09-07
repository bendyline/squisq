import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { EditorProvider } from '../EditorContext';
import { InlinePreviewGutter } from '../InlinePreviewGutter';

/**
 * The gutter pulls its data from the EditorContext's parsed Doc. We mount
 * it against a real provider seeded with markdown that contains both an
 * annotated heading (`{[title]}`) and a plain heading. The first
 * should produce a card; the second should be ignored.
 *
 * We deliberately don't snapshot the SVG — the BlockRenderer covers that
 * elsewhere. Here we just assert (a) the gutter mounts, (b) it renders
 * one card per annotated block, and (c) the gutter stays collapsed when
 * there are no annotated blocks.
 */

function renderGutter(markdown: string) {
  return render(
    <EditorProvider initialMarkdown={markdown} initialView="wysiwyg" articleId="test">
      <InlinePreviewGutter />
    </EditorProvider>,
  );
}

describe('InlinePreviewGutter', () => {
  it('stays collapsed when no blocks are template-annotated', () => {
    const { container } = renderGutter('# Plain heading\n\nSome body text.\n');
    expect(container.querySelector('[data-testid="inline-preview-gutter"]')).toBeNull();
  });

  it('renders one card per template-annotated block', async () => {
    const md = [
      '# Welcome {[title]}',
      '',
      'Subtitle goes here.',
      '',
      '## Plain heading',
      '',
      'No template tag — should not produce a card.',
      '',
      '## Big number {[statHighlight]}',
      '',
      '42',
    ].join('\n');

    const { container } = renderGutter(md);

    // Two annotated headings → two cards.
    await screen.findByTestId('inline-preview-gutter');
    const cards = container.querySelectorAll('.squisq-inline-preview-card');
    expect(cards.length).toBe(2);

    // Template labels are rendered alongside each card.
    const labels = Array.from(
      container.querySelectorAll('.squisq-inline-preview-card-template'),
    ).map((el) => el.textContent);
    // Templates render their human-readable label (via `templateLabel`).
    expect(labels).toContain('Title');
    expect(labels).toContain('Stat Highlight');
  });

  it('renders rows resolved from a data sidecar', async () => {
    const sidecar = 'report_files/data/report.csv';
    const container = new MemoryContentContainer();
    await container.writeFile(
      sidecar,
      new TextEncoder().encode('Name,Value\nAlpha,100\nBeta,200\n'),
      'text/csv',
    );
    const markdown = [`# Report {[dataTable src=${sidecar}]}`, '', `[report.csv](${sidecar})`].join(
      '\n',
    );

    const { container: rendered } = render(
      <EditorProvider
        initialMarkdown={markdown}
        initialView="wysiwyg"
        articleId="report"
        workspaceContainer={container}
        fileName="report_files/report.md"
      >
        <InlinePreviewGutter />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(rendered.querySelector('th')?.textContent).toBe('Name');
      expect(rendered.querySelector('td')?.textContent).toBe('Alpha');
    });
  });
});
