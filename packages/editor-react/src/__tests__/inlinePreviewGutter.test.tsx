import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorProvider } from '../EditorContext';
import { InlinePreviewGutter } from '../InlinePreviewGutter';

/**
 * The gutter pulls its data from the EditorContext's parsed Doc. We mount
 * it against a real provider seeded with markdown that contains both an
 * annotated heading (`{[titleBlock]}`) and a plain heading. The first
 * should produce a card; the second should be ignored.
 *
 * We deliberately don't snapshot the SVG — the BlockRenderer covers that
 * elsewhere. Here we just assert (a) the gutter mounts, (b) it renders
 * one card per annotated block, and (c) the empty state shows when there
 * are no annotated blocks.
 */

function renderGutter(markdown: string) {
  return render(
    <EditorProvider initialMarkdown={markdown} initialView="wysiwyg" articleId="test">
      <InlinePreviewGutter />
    </EditorProvider>,
  );
}

describe('InlinePreviewGutter', () => {
  it('renders the empty state when no blocks are template-annotated', async () => {
    renderGutter('# Plain heading\n\nSome body text.\n');
    expect(await screen.findByText(/tag a heading with a template/i)).toBeTruthy();
  });

  it('renders one card per template-annotated block', async () => {
    const md = [
      '# Welcome {[titleBlock]}',
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
    expect(labels).toContain('titleBlock');
    expect(labels).toContain('statHighlight');
  });
});
