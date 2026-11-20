/**
 * @vitest-environment jsdom
 */
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DisplayMode } from '@bendyline/squisq-react';
import { flattenBlocks } from '@bendyline/squisq/doc';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewSettingsProvider, PreviewToolbarControls } from '../PreviewControls';
import { PreviewPanel } from '../PreviewPanel';
import { useReportActiveSlide } from '../slideshow/ActiveSlide';

/** The slide a test puts on screen, standing in for the player. */
type TestSlide =
  { blockIndex: number; generated?: boolean } | { blockId: string } | { cover: true } | null;

function SlideReporter({ slide }: { slide: TestSlide }) {
  const { doc, markdownSource } = useEditorContext();
  const report = useReportActiveSlide();
  useEffect(() => {
    if (slide === null) {
      report(null);
    } else if ('cover' in slide) {
      report({ blockId: null, isCover: true, generated: false });
    } else if ('blockId' in slide) {
      report({ blockId: slide.blockId, isCover: false, generated: false });
    } else if (doc) {
      report({
        blockId: flattenBlocks(doc.blocks)[slide.blockIndex]?.id ?? null,
        isCover: false,
        generated: !!slide.generated,
      });
    }
  }, [doc, report, slide]);
  return <pre data-testid="markdown-source">{markdownSource}</pre>;
}

function Harness({ slide, displayMode }: { slide: TestSlide; displayMode?: DisplayMode }) {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <PreviewToolbarControls displayMode={displayMode} />
      <SlideReporter slide={slide} />
    </PreviewSettingsProvider>
  );
}

function renderControl(markdown: string, slide: TestSlide, displayMode?: DisplayMode) {
  render(
    <EditorProvider initialMarkdown={markdown}>
      <Harness slide={slide} displayMode={displayMode} />
    </EditorProvider>,
  );
}

// The zero-width jsdom toolbar folds every control into its measuring probe,
// so the trigger is found by class rather than by accessible role.
function trigger(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    '.squisq-slide-block-type .squisq-template-picker-trigger',
  );
  if (!button) throw new Error('The block-type control is not rendered');
  return button;
}

/**
 * A picker with no type to change stays pressable, so a press can say why;
 * it is disabled to assistive technology, not to the pointer.
 */
function disabled(): boolean {
  return trigger().getAttribute('aria-disabled') === 'true';
}

function reason(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.squisq-template-picker-reason');
}

function source(): string {
  return screen.getByTestId('markdown-source').textContent ?? '';
}

async function chooseBlockType(label: string) {
  fireEvent.click(trigger());
  const dialog = await screen.findByRole('dialog');
  const card = Array.from(dialog.querySelectorAll('.squisq-template-gallery-card')).find(
    (candidate) =>
      candidate.querySelector('.squisq-template-gallery-card-name')?.textContent === label,
  );
  if (!card) throw new Error(`No "${label}" card in the block-type gallery`);
  fireEvent.click(card);
}

const DECK = '# Intro\n\nHello there.\n\n## Numbers\n\nA few plain words about the year.\n';

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  cleanup();
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
});

describe('Slideshow block-type control', () => {
  it('names the type the slide on screen is drawn with', async () => {
    renderControl(DECK, { blockIndex: 1 });
    await waitFor(() => expect(disabled()).toBe(false));
    // No annotation on the heading: the section shows as a content slide.
    expect(trigger().textContent).toContain('Content');
    expect(trigger().title).toBe('Block type: Content. Change it for this slide.');
  });

  it('names a type that was picked for the section automatically', async () => {
    // A lone figure in the body makes the section a stat slide without any
    // annotation; the control shows what is on screen, not "(No visual)".
    renderControl('# Intro\n\n## Numbers\n\nRevenue grew 40% this year.\n', { blockIndex: 1 });
    await waitFor(() => expect(trigger().textContent).toContain('Stat Highlight'));
    expect(disabled()).toBe(false);
  });

  it('writes the chosen type onto that section’s heading and nowhere else', async () => {
    renderControl(DECK, { blockIndex: 1 });
    await waitFor(() => expect(disabled()).toBe(false));

    await chooseBlockType('Stat Highlight');

    await waitFor(() =>
      expect(source()).toBe(DECK.replace('## Numbers', '## Numbers {[statHighlight]}')),
    );
    await waitFor(() => expect(trigger().textContent).toContain('Stat Highlight'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('titles the gallery with the section it will change', async () => {
    renderControl(DECK, { blockIndex: 1 });
    await waitFor(() => expect(disabled()).toBe(false));
    fireEvent.click(trigger());
    expect(await screen.findByRole('dialog', { name: 'Block Type for Numbers' })).toBeTruthy();
  });

  it('removes the type again when none is chosen', async () => {
    renderControl('# Intro\n\n## Numbers {[statHighlight]}\n\nRevenue grew 40%.\n', {
      blockIndex: 1,
    });
    await waitFor(() => expect(trigger().textContent).toContain('Stat Highlight'));

    fireEvent.click(trigger());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelector('.squisq-template-gallery-none')!);

    await waitFor(() => expect(source()).toBe('# Intro\n\n## Numbers\n\nRevenue grew 40%.\n'));
  });

  it('follows the deck to another slide', async () => {
    const { rerender } = render(
      <EditorProvider initialMarkdown={DECK.replace('# Intro', '# Intro {[title]}')}>
        <Harness slide={{ blockIndex: 0 }} />
      </EditorProvider>,
    );
    await waitFor(() => expect(trigger().textContent).toContain('Title'));
    rerender(
      <EditorProvider initialMarkdown={DECK.replace('# Intro', '# Intro {[title]}')}>
        <Harness slide={{ blockIndex: 1 }} />
      </EditorProvider>,
    );
    await waitFor(() => expect(trigger().textContent).toContain('Content'));
  });

  it('is offered in Slideshow only', async () => {
    renderControl(DECK, { blockIndex: 1 }, 'video');
    expect(document.querySelector('.squisq-slide-block-type')).toBeNull();
    cleanup();
    renderControl(DECK, { blockIndex: 1 }, 'linear');
    expect(document.querySelector('.squisq-slide-block-type')).toBeNull();
    cleanup();
    renderControl(DECK, { blockIndex: 1 }, 'slideshow');
    expect(document.querySelector('.squisq-slide-block-type')).not.toBeNull();
  });

  it('is labelled "Slide:" and named for the type it shows', async () => {
    renderControl(DECK, { blockIndex: 1 });
    await waitFor(() => expect(disabled()).toBe(false));
    const control = document.querySelector('.squisq-slide-block-type')!;
    const label = control.querySelector('label')!;
    expect(label.textContent).toBe('Slide:');
    // The host's label stands in for the picker's own "Block:".
    expect(trigger().textContent).not.toContain('Block:');
    const [labelRef, selfRef] = trigger().getAttribute('aria-labelledby')!.split(' ');
    expect(document.getElementById(labelRef)).toBe(label);
    expect(selfRef).toBe(trigger().id);
    expect(label.htmlFor).toBe(trigger().id);
  });

  it('shows the cover but leaves it to the cover menu', async () => {
    renderControl(DECK, { cover: true });
    await waitFor(() => expect(trigger().textContent).toContain('Cover'));
    expect(disabled()).toBe(true);
    expect(trigger().title).toMatch(/Cover slide menu/);
    fireEvent.click(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains that Summarize chooses the layout of generated slides', async () => {
    renderControl(DECK, { blockIndex: 1, generated: true });
    await waitFor(() => expect(trigger().title).toMatch(/choose None in Write › Summarize/));
    expect(disabled()).toBe(true);
  });

  it('says why at a press when the slide has no type to change', async () => {
    // A finger cannot hover to raise the tooltip, so the press says it.
    renderControl(DECK, { blockIndex: 1, generated: true });
    await waitFor(() => expect(disabled()).toBe(true));
    expect(reason()).toBeNull();

    fireEvent.click(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('tooltip').textContent).toMatch(/choose None in Write › Summarize/);
    expect(trigger().getAttribute('aria-describedby')).toBe(reason()!.id);

    // Pressing again puts it away…
    fireEvent.click(trigger());
    expect(reason()).toBeNull();

    // …and so does a press anywhere else.
    fireEvent.click(trigger());
    expect(reason()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(reason()).toBeNull();
  });

  it('puts the reason away with Escape', async () => {
    renderControl(DECK, { cover: true });
    await waitFor(() => expect(disabled()).toBe(true));
    fireEvent.click(trigger());
    expect(reason()?.textContent).toMatch(/Cover slide menu/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(reason()).toBeNull();
  });

  it('keeps the reason up when its own label is pressed', async () => {
    renderControl(DECK, { cover: true });
    await waitFor(() => expect(disabled()).toBe(true));
    fireEvent.click(trigger());
    const label = document.querySelector<HTMLLabelElement>('.squisq-slide-block-type label')!;
    fireEvent.pointerDown(label);
    expect(reason()).not.toBeNull();
  });

  it('is disabled for a slide that is no section of the document', async () => {
    renderControl(DECK, { blockId: 'img-interleave-0' });
    await waitFor(() => expect(trigger().title).toMatch(/has no block type/));
    expect(disabled()).toBe(true);
  });

  it('is disabled for content that has no heading to carry a type', async () => {
    renderControl('Opening words before any heading.\n\n# Later\n\nBody.\n', { blockIndex: 0 });
    await waitFor(() => expect(trigger().title).toMatch(/only be changed in Write/));
    expect(disabled()).toBe(true);
  });

  it('is disabled until a slide is showing', () => {
    renderControl(DECK, null);
    expect(disabled()).toBe(true);
    expect(trigger().title).toBe('No slide is showing yet.');
  });

  it('resolves a slide the player paced into parts back to its section', async () => {
    renderControl(DECK, { blockId: 'numbers-split-1' });
    await waitFor(() => expect(disabled()).toBe(false));
    await chooseBlockType('Quote');
    await waitFor(() => expect(source()).toContain('## Numbers {[quote]}'));
  });
});

describe('Slideshow block-type control with the real player', () => {
  function PlayerHarness() {
    const { doc, markdownSource } = useEditorContext();
    return (
      <PreviewSettingsProvider doc={doc}>
        <PreviewToolbarControls />
        <PreviewPanel />
        <pre data-testid="markdown-source">{markdownSource}</pre>
      </PreviewSettingsProvider>
    );
  }

  it('changes the type of the slide the player is showing', async () => {
    // No cover, so the deck opens on the first section.
    const markdown = `---\nsquisq-cover-slide: false\n---\n\n${DECK}`;
    render(
      <EditorProvider initialMarkdown={markdown} initialView="preview">
        <PlayerHarness />
      </EditorProvider>,
    );

    await waitFor(() => expect(disabled()).toBe(false));
    expect(trigger().textContent).toContain('Content');

    await chooseBlockType('Title');

    await waitFor(() => expect(source()).toContain('# Intro {[title]}'));
    await waitFor(() => expect(trigger().textContent).toContain('Title'));
    // The second section was not the one on screen.
    expect(source()).toContain('## Numbers\n');
  });
});
