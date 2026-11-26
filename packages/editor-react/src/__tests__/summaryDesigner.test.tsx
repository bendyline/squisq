/**
 * @vitest-environment jsdom
 *
 * The Custom summary designer (Write › Summarize, Custom). It saves the
 * author's intent in the document as each change is made — the density as a
 * frontmatter key, a section's layout on its heading, wording, AI suggestions
 * and hidden slides as `{[summary]}` blocks under the section — follows the
 * document when something else changes that design, converts a design saved
 * the old way on its first change, and offers "Suggest with AI" only when a
 * host lends a `SummarizationAssistant`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildNarrationScript } from '@bendyline/squisq/narration';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  PRESENTATION_HINTS_KEY,
  PRESENTATION_LIMITS,
  createPresentationPlan,
  defaultPresentationHints,
  serializePresentationHints,
  type PresentationBeat,
  type PresentationPlan,
} from '@bendyline/squisq/transform';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { SummaryDesigner } from '../summarize/SummaryDesigner';
import type {
  SummarizationAssistant,
  SuggestSlidesOptions,
} from '../summarize/summarizationAssistant';

beforeEach(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
});

afterEach(cleanup);

const source: { latest: string; set: (markdown: string) => void } = {
  latest: '',
  set: () => undefined,
};
function SourceProbe() {
  const context = useEditorContext();
  source.latest = context.markdownSource;
  source.set = context.setMarkdownSource;
  return null;
}

function renderDesigner(
  markdown: string,
  options: {
    container?: MemoryContentContainer;
    assistant?: SummarizationAssistant;
    readOnly?: boolean;
  } = {},
) {
  return render(
    <EditorProvider initialMarkdown={markdown} workspaceContainer={options.container}>
      <SourceProbe />
      <SummaryDesigner assistant={options.assistant} readOnly={options.readOnly} />
    </EditorProvider>,
  );
}

const designer = () => screen.getByRole('region', { name: 'Summarization designer' });
const slides = () =>
  within(screen.getByRole('navigation', { name: 'Presentation slides' })).getAllByRole('button');
const statuses = () =>
  within(designer())
    .getAllByRole('status')
    .map((item) => item.textContent ?? '')
    .join(' ');
const density = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Summary density' });
const hideSlide = () =>
  screen.getByRole<HTMLInputElement>('checkbox', { name: 'Hide this slide in the presentation' });
const layout = () =>
  screen.getByRole<HTMLSelectElement>('combobox', { name: 'Layout preference for this section' });
const preview = () => screen.getByRole('img', { name: /^Slide \d/ });

const PINNED = [
  '{[audio src=audio/take.webm anchor=document]}',
  '',
  '# Start with an idea',
  '',
  'Write a few bullet points. Build a document with a clear story.',
  '',
  '## Make it visual {[duration=3]}',
  '',
  'First organize your points. Then add diagrams. Finally share your presentation.',
  '',
  '## Keep your voice',
  '',
  'Narration runs locally. Turn the same document into a narrated video.',
].join('\n');

/** A workspace holding a narration take whose timing sidecar matches `markdown`. */
async function narratedWorkspace(markdown: string) {
  const script = buildNarrationScript(markdownToDoc(parseMarkdown(markdown)));
  const times = [0, 20, 40, 60];
  const container = new MemoryContentContainer();
  await container.writeFile('audio/take.webm', new Uint8Array([1]), 'audio/webm');
  await container.writeFile(
    'audio/take.webm.timing.json',
    new TextEncoder().encode(
      JSON.stringify({
        version: 3,
        sourceText: script.sourceText,
        duration: times[times.length - 1],
        blocks: script.blocks.map((block, index) => ({
          ...block,
          blockIndex: index,
          startSec: times[index],
          endSec: times[index + 1],
        })),
        bookmarks: script.tokens.map((token, index) => ({
          id: `word-${index}`,
          charOffset: token.charOffset,
          time:
            times[token.blockIndex]! + (index - script.blocks[token.blockIndex]!.tokenStart) * 0.2,
        })),
      }),
    ),
    'application/json',
  );
  return container;
}

const REPORT = [
  '# Results',
  '',
  'Revenue grew 40% last year. Most of it came from new customers.',
  '',
  '## By region {[barChart]}',
  '',
  'North led every quarter.',
  '',
  '| Region | Sales |',
  '| --- | --- |',
  '| North | 40 |',
  '| South | 25 |',
].join('\n');

const LONG = [
  '# Plan',
  '',
  'Each slide should carry one idea that the narration explains in more depth. '.repeat(8),
  '',
  '## Next',
  '',
  'Ship it soon.',
].join('\n');

/** One section long enough for several slides, each from a passage of its own. */
const STORY = [
  '# Plan',
  '',
  ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']
    .map((nth) => `The ${nth} slide should carry one idea that the narration explains in depth.`)
    .join(' '),
  '',
  '## Next',
  '',
  'Ship it soon.',
].join('\n');

const DECK = [
  '# Launch plan',
  '',
  'We ship the editor in March. Two teams share the work.',
  '',
  '## What ships',
  '',
  'The editor, the exporter and the slide designer ship together.',
  '',
  '## Who does what',
  '',
  'Design owns the look. Engineering owns the exporter. Support owns the guide.',
].join('\n');

function chooseOption(select: HTMLSelectElement, value: string) {
  fireEvent.change(select, { target: { value } });
}

describe('SummaryDesigner', () => {
  it('previews the slides, explains a pinned time, and removes it in one step', async () => {
    renderDesigner(PINNED, { container: await narratedWorkspace(PINNED) });
    const alert = await within(designer()).findByRole('alert');
    expect(alert.textContent).toContain('manually pinned');
    expect(statuses()).toContain('Not synchronized with the narration');
    expect(preview().childElementCount).toBeGreaterThan(0);

    fireEvent.click(within(alert).getByRole('button', { name: 'Remove pinned times' }));
    await waitFor(() => expect(within(designer()).queryByRole('alert')).toBeNull());
    expect(source.latest).toContain('## Make it visual\n');
    expect(source.latest).not.toContain('duration=');
    await waitFor(() => expect(statuses()).toContain('Follows narration'));
  });

  it('shows a section as authored, naming its block type, and saves the choice as made', async () => {
    renderDesigner(REPORT);
    await waitFor(() => expect(slides().length).toBeGreaterThan(1));
    const list = screen.getByRole('navigation', { name: 'Presentation slides' });
    fireEvent.click(
      within(within(list).getByRole('group', { name: /^By region/ })).getAllByRole('button')[0]!,
    );
    const options = Array.from(layout().options).map((option) => option.textContent);
    expect(options).toContain('As authored (Bar Chart)');
    // Squisq names its own layouts, including the ones that draw a shape.
    expect(options).toEqual(
      expect.arrayContaining(['Key number', 'Quote', 'Big statement', 'Pyramid', 'Matrix']),
    );

    chooseOption(layout(), 'authored');
    await waitFor(() =>
      expect(source.latest).toMatch(/^## By region \{\[barChart slideLayout=authored\]\}$/m),
    );
    // Only the heading's tag changes; the document text is left as written.
    expect(source.latest).toBe(REPORT.replace('{[barChart]}', '{[barChart slideLayout=authored]}'));
    expect(screen.getByText(/block picker/)).toBeTruthy();
    // Nothing to word and no supporting slides: the section is shown as written.
    expect(screen.queryByText('Customize slide wording (slides only)')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Supporting slides for this section' })).toBe(
      null,
    );
  });

  it('collapses each section to one slide and rests the supporting-slide controls', async () => {
    renderDesigner(LONG);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    const supporting = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Add supporting visual slides where useful',
    });
    expect(supporting.checked).toBe(true);

    chooseOption(density(), 'section');
    await waitFor(() => expect(slides()).toHaveLength(2));
    expect(supporting.checked).toBe(false);
    expect(supporting.disabled).toBe(true);
    expect(source.latest).toContain('squisq-summary-density: section');
  });

  it('says why it cannot make the slides instead of still preparing them', async () => {
    const sections = PRESENTATION_LIMITS.beats + 1;
    renderDesigner(
      Array.from({ length: sections }, (_, index) => `## Part ${index + 1}\n\nShort line.`).join(
        '\n\n',
      ),
    );
    const alert = await within(designer()).findByRole('alert');
    expect(alert.textContent).toContain(`makes ${sections} slides`);
    expect(statuses()).not.toContain('Preparing slides');
  });

  it('hides a slide by its passage, keeps one slide shown, and saves a summary naming it', async () => {
    renderDesigner(LONG);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    const count = slides().length;
    fireEvent.click(slides()[1]!);
    fireEvent.click(hideSlide());
    await waitFor(() => expect(statuses()).toMatch(new RegExp(`${count - 1} slides · 1 hidden`)));
    expect(slides()).toHaveLength(count);
    expect(slides()[1]!.textContent).toContain('Hidden');
    expect(preview().getAttribute('aria-label')).toMatch(/\(hidden\)/);

    // A new split has new passages, so nothing hidden carries over.
    chooseOption(density(), 'section');
    await waitFor(() => expect(statuses()).not.toContain('hidden'));
    fireEvent.click(slides()[0]!);
    fireEvent.click(hideSlide());
    await waitFor(() => expect(statuses()).toMatch(/1 slide · 1 hidden/));
    fireEvent.click(slides()[1]!);
    expect(hideSlide().disabled).toBe(true);
    // Both are kept, so returning to Balanced hides its slide again. Each is a
    // summary that only hides its slide: a heading naming it, no points.
    await waitFor(() =>
      expect(
        source.latest.match(/^## Plan \{\[summary passage=[0-9a-z]+-[0-9a-z]+ hidden=true\]\}$/gm),
      ).toHaveLength(2),
    );
    expect(source.latest).not.toMatch(/hidden=true\]\}\n\n- /);
    expect(source.latest.match(/Each slide should carry/g)).toHaveLength(8);
    // The one Balanced made is not in use at One slide per section, and says so.
    expect(within(designer()).getByText('1 summary in the document is not in use')).toBeTruthy();
  });

  it('groups the slides under the block of the document each was made from', async () => {
    renderDesigner(LONG);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    const list = screen.getByRole('navigation', { name: 'Presentation slides' });
    const groups = within(list).getAllByRole('group');
    expect(groups).toHaveLength(2);
    const [plan, next] = groups as [HTMLElement, HTMLElement];
    const planSlides = within(plan).getAllByRole('button');
    expect(within(list).getByRole('group', { name: `Plan ${planSlides.length} slides` })).toBe(
      plan,
    );
    expect(within(list).getByRole('group', { name: 'Next 1 slide' })).toBe(next);
    expect(planSlides.length + within(next).getAllByRole('button').length).toBe(slides().length);

    // The group names the block, so its slides say which part of it they cover.
    expect(planSlides[0]!.textContent).toMatch(/^1\. Each slide should carry one idea/);
    for (const slide of planSlides) expect(slide.textContent).not.toMatch(/^\d+\. Plan\b/);

    // The block of the chosen slide is marked, and the picker groups the same way.
    expect(plan.className).toContain('squisq-summary-designer-section--current');
    fireEvent.click(within(next).getByRole('button'));
    expect(next.className).toContain('squisq-summary-designer-section--current');
    expect(plan.className).not.toContain('squisq-summary-designer-section--current');
    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Slide' });
    expect(Array.from(picker.querySelectorAll('optgroup')).map((group) => group.label)).toEqual([
      'Plan',
      'Next',
    ]);
  });

  it('opens the slide wording above the document text, and keeps it closed once closed', async () => {
    renderDesigner(LONG);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    const wording = () =>
      screen.queryByText('Customize slide wording (slides only)')?.closest('details') ?? null;
    const original = () => screen.getByRole('region', { name: 'Original document text' });
    expect(wording()?.open).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Slide headline' })).toBeTruthy();
    expect(
      wording()!.compareDocumentPosition(original()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    wording()!.open = false;
    fireEvent(wording()!, new Event('toggle'));
    // Every summary slide has wording to change, and it stays closed from slide to slide.
    fireEvent.click(slides()[1]!);
    expect(wording()?.open).toBe(false);
    fireEvent.click(slides()[0]!);
    expect(wording()?.open).toBe(false);
  });

  it('words any slide by its passage, until that passage changes', async () => {
    renderDesigner(STORY);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    const help = () =>
      screen.getByText('Customize slide wording (slides only)').closest('details')!.textContent;
    expect(help()).toContain('This section’s opening slide can use your wording.');
    fireEvent.click(slides()[1]!);
    expect(help()).toContain('with the passage it summarizes');
    expect(screen.queryByRole('button', { name: 'Use automatic wording' })).toBeNull();

    const headline = screen.getByRole<HTMLInputElement>('textbox', { name: 'Slide headline' });
    fireEvent.change(headline, { target: { value: 'The middle of the plan' } });
    fireEvent.blur(headline);
    await waitFor(() =>
      expect(source.latest).toMatch(
        /^## The middle of the plan \{\[summary passage=[0-9a-z]+-[0-9a-z]+\]\}$/m,
      ),
    );
    expect(preview().getAttribute('aria-label')).toBe('Slide 2: The middle of the plan');
    expect(slides()[0]!.textContent).not.toContain('The middle of the plan');
    expect(screen.getByRole('button', { name: 'Use automatic wording' })).toBeTruthy();

    // Another passage is another slide: it goes back to automatic wording, and
    // the summary stays in the document, listed as not in use.
    act(() => source.set(source.latest.replace(/should carry/g, 'must carry')));
    await waitFor(() =>
      expect(within(designer()).getByText('1 summary in the document is not in use')).toBeTruthy(),
    );
    for (const slide of slides()) expect(slide.textContent).not.toContain('The middle of the plan');
  });

  it('keeps a slide’s headline while it is hidden, and takes it off keeping the slide hidden', async () => {
    renderDesigner(STORY);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    fireEvent.click(slides()[1]!);
    const automatic = preview().getAttribute('aria-label')!;
    const headline = screen.getByRole<HTMLInputElement>('textbox', { name: 'Slide headline' });
    fireEvent.change(headline, { target: { value: 'Worded by hand' } });
    fireEvent.blur(headline);
    await waitFor(() => expect(source.latest).toContain('## Worded by hand {[summary passage='));

    // A hidden summary's lone heading only names its slide, so hiding a slide
    // worded by its headline alone saves its points too, and the headline stays.
    fireEvent.click(hideSlide());
    await waitFor(() =>
      expect(preview().getAttribute('aria-label')).toBe('Slide 2 (hidden): Worded by hand'),
    );
    expect(source.latest).toMatch(
      /^## Worded by hand \{\[summary passage=[0-9a-z]+-[0-9a-z]+ hidden=true\]\}\n\n- The fourth slide/m,
    );
    fireEvent.click(hideSlide());
    await waitFor(() =>
      expect(preview().getAttribute('aria-label')).toBe('Slide 2: Worded by hand'),
    );
    fireEvent.click(hideSlide());
    await waitFor(() => expect(statuses()).toContain('1 hidden'));

    fireEvent.click(screen.getByRole('button', { name: 'Use automatic wording' }));
    await waitFor(() =>
      expect(preview().getAttribute('aria-label')).toBe(
        automatic.replace(/^Slide 2:/, 'Slide 2 (hidden):'),
      ),
    );
    expect(statuses()).toContain('1 hidden');
    expect(source.latest.match(/\{\[summary/g)).toHaveLength(1);
    expect(source.latest).toMatch(/\{\[summary passage=[0-9a-z]+-[0-9a-z]+ hidden=true\]\}$/m);
    expect(screen.queryByRole('button', { name: 'Use automatic wording' })).toBeNull();
  });

  it('offers the same slides in the picker, with Previous and Next', async () => {
    renderDesigner(LONG);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Slide' });
    const count = slides().length;
    expect(picker.options).toHaveLength(count);
    slides().forEach((button, index) =>
      expect(picker.options[index]!.textContent).toContain(`${index + 1}. ${button.title} · `),
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous slide' }).disabled).toBe(
      true,
    );
    chooseOption(picker, '2');
    expect(preview().getAttribute('aria-label')).toMatch(/^Slide 3:/);
    expect(slides()[2]!.getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(preview().getAttribute('aria-label')).toMatch(/^Slide 2:/);
    expect(picker.value).toBe('1');
    chooseOption(picker, String(count - 1));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next slide' }).disabled).toBe(
      true,
    );
  });

  it('writes nothing on open, saves each change, and follows an undo without writing back', async () => {
    renderDesigner(LONG);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    expect(source.latest).toBe(LONG);

    chooseOption(density(), 'concise');
    await waitFor(() => expect(source.latest).toContain('squisq-summary-density: concise'));
    expect(source.latest.endsWith(LONG)).toBe(true);

    // An undo in Write puts the document back. The designer follows it, and
    // does not write its own design back over it.
    act(() => source.set(LONG));
    await waitFor(() => expect(density().value).toBe('balanced'));
    expect(source.latest).toBe(LONG);
  });

  it('keeps your opening wording when the text changes, and saves nothing for an untouched field', async () => {
    renderDesigner(DECK);
    await waitFor(() => expect(slides().length).toBeGreaterThan(1));
    const headline = screen.getByRole<HTMLInputElement>('textbox', { name: 'Slide headline' });
    fireEvent.blur(headline);
    fireEvent.blur(screen.getByRole('textbox', { name: 'Slide highlights, one per line' }));
    expect(source.latest).toBe(DECK);

    fireEvent.change(headline, { target: { value: 'March, together' } });
    fireEvent.blur(headline);
    await waitFor(() =>
      expect(source.latest).toContain(
        'Two teams share the work.\n\n## March, together {[summary]}\n\n## What ships',
      ),
    );
    act(() => source.set(source.latest.replace('in March', 'in April')));
    await waitFor(() => expect(preview().getAttribute('aria-label')).toMatch(/March, together/));

    fireEvent.click(screen.getByRole('button', { name: 'Use automatic wording' }));
    await waitFor(() => expect(source.latest).not.toContain('{[summary]}'));
  });

  it('follows a summary written by hand, and lists and removes one not in use', async () => {
    renderDesigner(
      `${DECK.replace('Two teams share the work.', 'Two teams share the work.\n\n## Typed by hand {[summary]}')}\n\n### Old {[summary passage=zzzz-1 hidden=true]}`,
    );
    await waitFor(() => expect(preview().getAttribute('aria-label')).toMatch(/Typed by hand/));
    const unused = await within(designer()).findByText('1 summary in the document is not in use');
    fireEvent.click(unused);
    fireEvent.click(within(designer()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(source.latest).not.toContain('zzzz-1'));
    expect(source.latest).toContain('## Typed by hand {[summary]}');
  });

  it('converts a design saved the old way on its first change, keeping the deck', async () => {
    const doc = markdownToDoc(parseMarkdown(DECK));
    const plan = createPresentationPlan(doc);
    const legacy = {
      ...defaultPresentationHints(),
      blocks: [
        {
          blockId: 'what-ships',
          ai: [
            {
              source: plan.sourceText.slice(plan.beats[1]!.sourceStart, plan.beats[1]!.sourceEnd),
              layout: 'statement' as const,
              headline: 'Everything ships together',
              points: [],
            },
          ],
        },
      ],
    };
    const md = `---\n${PRESENTATION_HINTS_KEY}: ${serializePresentationHints(legacy)}\n---\n${DECK}`;
    renderDesigner(md);
    await waitFor(() => expect(slides()[1]!.textContent).toContain('Everything ships together'));
    expect(source.latest).toBe(md);

    chooseOption(density(), 'detailed');
    await waitFor(() => expect(source.latest).not.toContain(PRESENTATION_HINTS_KEY));
    expect(source.latest).toContain('squisq-summary-density: detailed');
    expect(source.latest).toMatch(
      /### Everything ships together \{\[summary passage=[0-9a-z]+-[0-9a-z]+ origin=ai layout=statement points=none\]\}/,
    );
    expect(statuses()).toContain('Slide summaries are now saved in the document');
  });

  it('resets every summary, setting and key in one step', async () => {
    renderDesigner(
      `---\nsquisq-summary-density: concise\n---\n${DECK.replace('# Launch plan', '# Launch plan {[slideLayout=cards]}')}\n\n### Old {[summary passage=zzzz-1 hidden=true]}`,
    );
    await waitFor(() => expect(slides().length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('button', { name: 'Reset design' }));
    // The document ends where its content does, with one line ending.
    await waitFor(() => expect(source.latest).toBe(`${DECK}\n`));
  });

  it('never changes what is narrated', async () => {
    renderDesigner(LONG);
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    const spoken = () =>
      buildNarrationScript(markdownToDoc(parseMarkdown(source.latest))).sourceText;
    const before = spoken();
    fireEvent.click(slides()[1]!);
    fireEvent.click(hideSlide());
    chooseOption(layout(), 'cards');
    await waitFor(() => expect(source.latest).toContain('slideLayout=cards'));
    expect(spoken()).toBe(before);
  });

  it('keeps the design but changes nothing when read-only', async () => {
    renderDesigner(LONG, { readOnly: true });
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    expect(density().disabled).toBe(true);
    expect(hideSlide().disabled).toBe(true);
    expect(layout().disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reset design' }).disabled).toBe(
      true,
    );
    // Moving between slides still works.
    fireEvent.click(slides()[1]!);
    expect(preview().getAttribute('aria-label')).toMatch(/^Slide 2:/);
    expect(source.latest).toBe(LONG);
  });
});

describe('SummaryDesigner with an assistant', () => {
  it('offers no AI without an assistant', async () => {
    renderDesigner(DECK);
    await waitFor(() => expect(slides().length).toBeGreaterThan(1));
    expect(screen.queryByRole('button', { name: 'Suggest with AI' })).toBeNull();
  });

  it('says why AI is unavailable, and follows the host when that changes', async () => {
    let reason: string | null = 'Turn on AI features in Settings.';
    let notify = () => undefined as void;
    const assistant: SummarizationAssistant = {
      readiness: async () => reason,
      onReadinessChange: (listener) => {
        notify = listener;
        return () => undefined;
      },
      suggestSlides: async () => undefined,
    };
    renderDesigner(DECK, { assistant });
    const suggest = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Suggest with AI',
    });
    await waitFor(() => expect(suggest.title).toBe('Turn on AI features in Settings.'));
    expect(suggest.disabled).toBe(true);
    // Said beside the button, not only in its tooltip, and read as its description.
    const shown = within(designer()).getByText('Turn on AI features in Settings.');
    expect(suggest.getAttribute('aria-describedby')).toBe(shown.id);

    reason = 'Built-in AI is restarting…';
    act(() => notify());
    await waitFor(() => expect(within(designer()).getByText(reason!)).toBeTruthy());

    reason = null;
    act(() => notify());
    await waitFor(() => expect(suggest.disabled).toBe(false));
    expect(within(designer()).queryByText(/Built-in AI/)).toBeNull();
    expect(suggest.hasAttribute('aria-describedby')).toBe(false);
  });

  it('says nothing about AI while it checks, or when the document is read-only', async () => {
    renderDesigner(DECK, {
      assistant: {
        readiness: () => new Promise<string | null>(() => undefined),
        suggestSlides: async () => undefined,
      },
    });
    const suggest = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Suggest with AI',
    });
    expect(suggest.title).toBe('Checking whether AI is available…');
    expect(suggest.hasAttribute('aria-describedby')).toBe(false);
    cleanup();

    renderDesigner(DECK, {
      readOnly: true,
      assistant: {
        readiness: () => 'Turn on AI features in Settings.',
        suggestSlides: async () => undefined,
      },
    });
    const locked = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Suggest with AI',
    });
    await waitFor(() => expect(locked.title).toBe('Turn on AI features in Settings.'));
    expect(screen.queryByText('Turn on AI features in Settings.')).toBeNull();
  });

  it('shows it is working from the click, holds its other buttons, and stops', async () => {
    const plans: PresentationPlan[] = [];
    const assistant: SummarizationAssistant = {
      readiness: () => null,
      // Plans the deck and never answers, until stopped.
      suggestSlides: (plan, { signal }) => {
        plans.push(plan);
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () =>
            reject(new DOMException('Stopped.', 'AbortError')),
          ),
        );
      },
    };
    renderDesigner(DECK, { assistant });
    const suggest = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Suggest with AI',
    });
    await waitFor(() => expect(suggest.disabled).toBe(false));

    fireEvent.click(suggest);
    expect(plans).toHaveLength(1);
    const progress = within(designer()).getByText('Planning the slides…').parentElement!;
    expect(progress.querySelector('progress')?.hasAttribute('value'), 'no amount yet').toBe(false);
    expect(screen.queryByRole('button', { name: 'Suggest with AI' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reset design' }).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(statuses()).toContain('Stopped after 0 of'));
    expect(screen.queryByText('Planning the slides…')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reset design' }).disabled).toBe(
      false,
    );
  });

  it('saves each suggestion as it arrives, marks it, and offers the host report', async () => {
    const report = vi.fn((output: string) => <button type="button">Report {output.length}</button>);
    const assistant: SummarizationAssistant = {
      readiness: () => null,
      suggestSlides: async (plan: PresentationPlan, options: SuggestSlidesOptions) => {
        options.onProgress(0, plan.beats.length);
        const first = plan.beats[0]!;
        const suggestion: PresentationBeat = { ...first, headline: 'A plan for March' };
        options.onBeat(0, suggestion);
        options.onProgress(plan.beats.length, plan.beats.length);
      },
      renderReport: report,
    };
    renderDesigner(DECK, { assistant });
    const suggest = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Suggest with AI',
    });
    await waitFor(() => expect(suggest.disabled).toBe(false));
    fireEvent.click(suggest);

    await waitFor(() => expect(statuses()).toContain('AI summaries are ready to review.'));
    await waitFor(() =>
      expect(source.latest).toMatch(
        /^## A plan for March \{\[summary passage=[0-9a-z]+-[0-9a-z]+ origin=ai layout=\w+/m,
      ),
    );
    expect(slides()[0]!.textContent).toContain('A plan for March');
    expect(slides()[0]!.textContent).toContain('Suggested by AI');
    expect(report).toHaveBeenCalled();
    expect(report.mock.calls[report.mock.calls.length - 1]?.[0]).toContain('A plan for March');
    expect(screen.getByRole('button', { name: /^Report \d+$/ })).toBeTruthy();
  });

  /** An assistant that suggests a Statement for the second slide, headlined `wording.text`. */
  const middleAssistant = (wording: { text: string }): SummarizationAssistant => ({
    readiness: () => null,
    suggestSlides: async (plan: PresentationPlan, options: SuggestSlidesOptions) => {
      options.onBeat(1, {
        ...plan.beats[1]!,
        layout: 'statement',
        headline: wording.text,
        points: ['An AI point'],
      });
      options.onProgress(plan.beats.length, plan.beats.length);
    },
  });
  const suggest = async () => {
    const button = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Suggest with AI',
    });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(statuses()).toContain('AI summaries are ready to review.'));
  };
  const typePoints = (value: string) => {
    const points = screen.getByRole('textbox', { name: 'Slide highlights, one per line' });
    fireEvent.change(points, { target: { value } });
    fireEvent.blur(points);
  };

  it('makes AI wording on any slide yours when you change it, and suggesting again keeps it', async () => {
    const wording = { text: 'Suggested middle' };
    renderDesigner(STORY, { assistant: middleAssistant(wording) });
    await suggest();
    await waitFor(() => expect(slides()[1]!.textContent).toContain('Suggested by AI'));

    fireEvent.click(slides()[1]!);
    const details = screen.getByText('Customize slide wording (slides only)').closest('details')!;
    expect(details.textContent).toContain('This wording was suggested by AI.');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Slide headline' }).value).toBe(
      'Suggested middle',
    );
    typePoints('My first point\nMy second point');

    // The whole slide is yours now: the AI's headline and layout, your points.
    await waitFor(() =>
      expect(source.latest).toMatch(
        /^## Suggested middle \{\[summary passage=[0-9a-z]+-[0-9a-z]+ layout=statement\]\}\n\n- My first point\n- My second point$/m,
      ),
    );
    expect(source.latest).not.toContain('origin=ai');
    expect(slides()[1]!.textContent).not.toContain('Suggested by AI');
    expect(screen.getByRole('button', { name: 'Use automatic wording' })).toBeTruthy();

    wording.text = 'Suggested again';
    await suggest();
    expect(source.latest).toContain('## Suggested middle {[summary passage=');
    expect(source.latest).not.toContain('Suggested again');
  });

  it('keeps a section’s layout preference in charge of AI wording you make yours', async () => {
    renderDesigner(STORY, { assistant: middleAssistant({ text: 'Suggested middle' }) });
    await waitFor(() => expect(slides().length).toBeGreaterThan(2));
    chooseOption(layout(), 'cards');
    await waitFor(() => expect(source.latest).toContain('# Plan {[slideLayout=cards]}'));
    await suggest();

    fireEvent.click(slides()[1]!);
    typePoints('My first point\nMy second point');
    await waitFor(() =>
      expect(source.latest).toMatch(
        /^## Suggested middle \{\[summary passage=[0-9a-z]+-[0-9a-z]+\]\}\n\n- My first point\n- My second point$/m,
      ),
    );
    expect(slides()[1]!.textContent).toContain('Cards');
  });
});

describe('SummaryDesigner with a block on the slide before it', () => {
  const ROLLED = REPORT.replace('{[barChart]}', '{[barChart slideLayout=feature]}');
  const WITH_TERMS = `${ROLLED}\n\n## Terms\n\nNet thirty days. Prices are fixed for the year.`;
  const group = (name: RegExp) =>
    within(screen.getByRole('navigation', { name: 'Presentation slides' })).getByRole('group', {
      name: name,
    });

  it('offers to show a chart on the last slide of the section before it, saving only the tag', async () => {
    renderDesigner(REPORT);
    await waitFor(() => expect(slides().length).toBeGreaterThan(1));
    fireEvent.click(within(group(/^By region/)).getAllByRole('button')[0]!);
    const offered = Array.from(layout().options).map((option) => option.textContent);
    expect(offered).toContain('On the last slide of “Results” (Bar Chart)');
    expect(offered.indexOf('On the last slide of “Results” (Bar Chart)')).toBe(
      offered.indexOf('As authored (Bar Chart)') + 1,
    );

    chooseOption(layout(), 'feature');
    await waitFor(() => expect(source.latest).toBe(ROLLED));
    await waitFor(() => expect(statuses()).toMatch(/\d+ slides? · 1 on another slide/));
    expect(screen.getByText(/still narrated while that slide stays up/)).toBeTruthy();

    // Switching back restores the document exactly.
    chooseOption(layout(), '');
    await waitFor(() => expect(source.latest).toBe(REPORT));
    await waitFor(() => expect(statuses()).not.toContain('on another slide'));
  });

  it('lists it without a number, tagged with the slide carrying it, and previews that slide', async () => {
    renderDesigner(WITH_TERMS);
    await waitFor(() => expect(statuses()).toContain('1 on another slide'));
    const entry = within(group(/^By region/)).getByRole('button');
    expect(group(/^By region/).textContent).toContain('On another slide');
    const results = within(group(/^Results/)).getAllByRole('button');
    const carrier = results[results.length - 1]!;
    const carrierNumber = Number(/^(\d+)\./.exec(carrier.textContent ?? '')?.[1]);
    expect(entry.textContent).not.toMatch(/^\d+\./);
    expect(entry.textContent).toContain('Bar Chart');
    expect(entry.textContent).toContain(`On slide ${carrierNumber}`);
    expect(carrier.textContent).toContain('Carries Bar Chart');
    // The next slide numbers as if the section had none.
    expect(within(group(/^Terms/)).getByRole('button').textContent).toMatch(
      new RegExp(`^${carrierNumber + 1}\\.`),
    );

    fireEvent.click(entry);
    expect(preview().getAttribute('aria-label')).toMatch(
      new RegExp(`^Slide ${carrierNumber}, which carries this section`),
    );
    expect(preview().childElementCount).toBeGreaterThan(0);
    // It has no slide of its own to hide, word, or add supporting slides to.
    expect(
      screen.queryByRole('checkbox', { name: 'Hide this slide in the presentation' }),
    ).toBeNull();
    expect(screen.queryByText('Customize slide wording (slides only)')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Supporting slides for this section' })).toBe(
      null,
    );
    expect(layout().value).toBe('feature');
  });

  it('crosses it with the arrow keys like any slide', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderDesigner(WITH_TERMS);
    await waitFor(() => expect(statuses()).toContain('1 on another slide'));
    const all = slides();
    const at = all.indexOf(within(group(/^By region/)).getByRole('button'));
    fireEvent.click(all[at - 1]!);
    fireEvent.keyDown(all[at - 1]!, { key: 'ArrowRight' });
    expect(slides()[at]!.getAttribute('aria-current')).toBe('step');
    fireEvent.keyDown(slides()[at]!, { key: 'ArrowRight' });
    expect(slides()[at + 1]!.getAttribute('aria-current')).toBe('step');
    expect(scroll).toHaveBeenCalled();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('says why it has a slide of its own when nothing before it can carry it', async () => {
    const first = [
      '## By region {[barChart slideLayout=feature]}',
      '',
      '| Region | Sales |',
      '| --- | --- |',
      '| North | 40 |',
      '',
      '## Terms',
      '',
      'Net thirty days.',
    ].join('\n');
    renderDesigner(first);
    await waitFor(() => expect(slides().length).toBeGreaterThan(1));
    expect(
      screen.getByText(
        'Nothing comes before this section to carry it, so it has a slide of its own.',
      ),
    ).toBeTruthy();
    expect(layout().getAttribute('aria-describedby')).toContain(
      screen.getByText(/^Nothing comes before/).id,
    );
    expect(statuses()).not.toContain('on another slide');
    cleanup();

    renderDesigner(ROLLED.replace('# Results', '# Results {[slideLayout=authored]}'));
    await waitFor(() => expect(slides().length).toBeGreaterThan(1));
    fireEvent.click(within(group(/^By region/)).getByRole('button'));
    expect(
      screen.getByText('“Results” is shown as authored, so this section has a slide of its own.'),
    ).toBeTruthy();
  });

  it('previews a block that reads its rows from a file', async () => {
    const sidecar = 'report_files/data/report.csv';
    const container = new MemoryContentContainer();
    await container.writeFile(
      sidecar,
      new TextEncoder().encode('Name,Value\nAlpha,100\nBeta,200\n'),
      'text/csv',
    );
    renderDesigner(
      [
        '# Results',
        '',
        'Revenue grew 40% last year. Most of it came from new customers.',
        '',
        `## Totals {[dataTable src=${sidecar} slideLayout=authored]}`,
        '',
        `[report.csv](${sidecar})`,
      ].join('\n'),
      { container },
    );
    await waitFor(() => expect(slides().length).toBeGreaterThan(1));
    fireEvent.click(within(group(/^Totals/)).getByRole('button'));
    await waitFor(() => expect(preview().textContent).toContain('Alpha'));
  });

  it('never saves AI wording for a section on another slide', async () => {
    const assistant: SummarizationAssistant = {
      readiness: () => null,
      // A host that asks about every slide, against Squisq's own rule.
      suggestSlides: async (plan: PresentationPlan, options: SuggestSlidesOptions) => {
        plan.beats.forEach((beat, index) =>
          options.onBeat(index, { ...beat, headline: `Reworded ${index}` }),
        );
        options.onProgress(plan.beats.length, plan.beats.length);
      },
    };
    renderDesigner(WITH_TERMS, { assistant });
    await waitFor(() => expect(statuses()).toContain('1 on another slide'));
    const suggest = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Suggest with AI',
    });
    await waitFor(() => expect(suggest.disabled).toBe(false));
    fireEvent.click(suggest);
    await waitFor(() => expect(source.latest).toContain('origin=ai'));
    await waitFor(() => expect(statuses()).toContain('Kept automatic summaries for 1 slides'));
    const regionPart = source.latest.slice(
      source.latest.indexOf('## By region'),
      source.latest.indexOf('## Terms'),
    );
    expect(regionPart).not.toContain('{[summary');
    expect(source.latest).toContain('## By region {[barChart slideLayout=feature]}');
  });
});
