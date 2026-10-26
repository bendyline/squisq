import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { EditorProvider } from '../EditorContext';
import { InlinePreviewGutter } from '../InlinePreviewGutter';

/** Exercise preview rendering against the real parser and editor provider. */

function renderGutter(markdown: string) {
  return render(
    <EditorProvider initialMarkdown={markdown} initialView="wysiwyg" articleId="test">
      <InlinePreviewGutter />
    </EditorProvider>,
  );
}

describe('InlinePreviewGutter', () => {
  it('stays collapsed for an empty document', () => {
    const { container } = renderGutter('');
    expect(container.querySelector('[data-testid="inline-preview-gutter"]')).toBeNull();
  });

  it.each([
    ['plain heading', '# Plain heading\n\nSome body text.\n', 'Some body text.', 'content'],
    [
      'heading-less prose',
      'An introduction without a heading.\n',
      'An introduction without a heading.',
      'content',
    ],
    [
      'inferred table',
      '# Results\n\n| Name | Value |\n| --- | --- |\n| Alpha | 100 |\n',
      'Alpha',
      'dataTable',
    ],
  ])('previews %s without a template tag', async (_name, markdown, body, template) => {
    const { container } = renderGutter(markdown);
    await screen.findByTestId('inline-preview-gutter');
    const cards = container.querySelectorAll('.squisq-inline-preview-card');
    expect(cards.length).toBe(1);
    expect(cards[0].getAttribute('data-template')).toBe(template);
    expect(cards[0].querySelector('.squisq-inline-preview-card-svg')?.textContent).toContain(body);
  });

  it('renders tagged and untagged blocks together', async () => {
    const md = [
      '# Welcome {[title]}',
      '',
      'Subtitle goes here.',
      '',
      '## Plain heading',
      '',
      'No template tag — still produces a card.',
      '',
      '## Big number {[statHighlight]}',
      '',
      '42',
    ].join('\n');

    const { container } = renderGutter(md);

    // Two annotated headings and one ordinary heading → three cards.
    await screen.findByTestId('inline-preview-gutter');
    const cards = container.querySelectorAll('.squisq-inline-preview-card');
    expect(cards.length).toBe(3);

    // Template labels are rendered alongside each card.
    const labels = Array.from(
      container.querySelectorAll('.squisq-inline-preview-card-template'),
    ).map((el) => el.textContent);
    // Templates render their human-readable label (via `templateLabel`).
    expect(labels).toContain('Content');
    expect(cards[1].textContent).toContain('No template tag — still produces a card.');
    expect(labels).toContain('Title');
    expect(labels).toContain('Stat Highlight');
  });

  it('previews authored block types when the slideshow uses dynamic slides', async () => {
    // Dynamic slides plan the deck from prose. Planning a single block made
    // every card that plan's opening title beat, ignoring the chosen type.
    const md = [
      '---',
      'squisq-transform: dynamic-slides',
      '---',
      '',
      '## The background',
      '',
      'It started as a simple editor.',
      '',
      '## Core engine {[factCard]}',
      '',
      'One engine renders every surface.',
    ].join('\n');

    const { container } = renderGutter(md);

    await screen.findByTestId('inline-preview-gutter');
    const cards = Array.from(container.querySelectorAll('.squisq-inline-preview-card'));
    expect(cards.map((card) => card.getAttribute('data-template'))).toEqual([
      'content',
      'factCard',
    ]);
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

  it('coerces authored params into the structured inputs a template takes', async () => {
    // twoColumn renders nothing unless `left`/`right` are `{ label, sublabel }`
    // objects; authors write them as "label|sublabel" strings.
    const md =
      '## Choose an app {[twoColumn header="Same Markdown" left="Web|In a browser." right="Desktop|In your folders."]}';

    const { container } = renderGutter(md);

    await screen.findByTestId('inline-preview-gutter');
    const card = container.querySelector('.squisq-inline-preview-card-svg');
    expect(card?.textContent).toContain('Same Markdown');
    expect(card?.textContent).toContain('Web');
    expect(card?.textContent).toContain('In your folders.');
  });
});
