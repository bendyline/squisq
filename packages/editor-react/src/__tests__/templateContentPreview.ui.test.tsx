import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { TemplateBadgePopover } from '../TemplatePicker';
import type { TemplatePreviewSource } from '../templateContentPreviewResolver';

const originalElementsFromPoint = document.elementsFromPoint;

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: originalElementsFromPoint,
  });
});

function source(markdown: string): TemplatePreviewSource {
  const doc = markdownToDoc(parseMarkdown(markdown), { autoTemplates: false });
  return { block: doc.blocks[0], theme: DEFAULT_THEME, viewport: VIEWPORT_PRESETS.landscape };
}

function gallery(previewSource: TemplatePreviewSource, onChange = vi.fn()) {
  return (
    <TemplateBadgePopover
      anchorRect={new DOMRect(20, 20, 80, 24)}
      value={previewSource.block.template ?? ''}
      onChange={onChange}
      onClose={vi.fn()}
      previewSource={previewSource}
    />
  );
}

function card(label: string): HTMLButtonElement {
  const button = screen
    .getByText(label, { selector: '.squisq-template-gallery-card-name' })
    .closest('button');
  if (!button) throw new Error(`Missing template card: ${label}`);
  return button;
}

describe('block type gallery content previews', () => {
  it('shows static WYSIWYG previews for mixed content without repeated warning overlays', () => {
    render(
      gallery(
        source(`## Notebook

Learn more about the model.

- Read the source
- Search the notes

![Architecture](media/architecture.png)`),
      ),
    );

    for (const label of [
      'Content',
      'Title',
      'List',
      'Two Column',
      'Left Feature',
      'Right Feature',
    ]) {
      expect(card(label).querySelector('svg.block-svg'), label).not.toBeNull();
      expect(card(label).title).not.toContain('No image found');
      expect(card(label).title).not.toContain('Use Content to preserve');
    }
    const title = card('Title').querySelector<SVGElement>('[data-layer-id="title"]');
    expect(title).not.toBeNull();
    expect(title?.style.opacity).not.toBe('0');
    expect(document.querySelector('.squisq-template-gallery-content-preview-warning')).toBeNull();
    expect(screen.queryByText('Use Content to preserve mixed prose and list structure')).toBeNull();
  });

  it('puts genuine missing inputs in the tooltip and keeps those choices selectable', () => {
    const onChange = vi.fn();
    render(gallery(source('## About\n\nSome context.'), onChange));

    const imageCard = card('Image with Caption');
    expect(imageCard.querySelector('svg.block-svg')).toBeNull();
    expect(imageCard.title).toContain('No image found in this block');
    expect(imageCard.textContent).not.toContain('No image found in this block');
    expect(screen.getByText('Needs Additional Content')).toBeTruthy();
    fireEvent.click(imageCard);
    expect(onChange).toHaveBeenCalledWith('imageWithCaption');
  });

  it('removes the missing-image tooltip when authored params supply the active feature', () => {
    const view = render(gallery(source('## Architecture')));
    expect(card('Right Feature').title).toContain('No visual feature found');

    view.rerender(
      gallery(source('## Architecture {[rightFeature imageSrc="media/authored.png"]}')),
    );
    expect(card('Right Feature').title).not.toContain('No visual feature found');
    expect(
      card('Right Feature').querySelector('svg.block-svg image, svg.block-svg img'),
    ).not.toBeNull();
    expect(card('Left Feature').title).not.toContain('No visual feature found');
    expect(
      card('Left Feature').querySelector('svg.block-svg image, svg.block-svg img'),
    ).not.toBeNull();
  });
});
