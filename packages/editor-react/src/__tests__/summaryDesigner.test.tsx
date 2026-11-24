/**
 * @vitest-environment jsdom
 *
 * The Custom summary designer (Write › Summarize, Custom). It saves the
 * author's intent — density, per-section layouts, hidden slides, wording,
 * AI suggestions — to `squisq-presentation-hints` as each change is made,
 * follows the document when something else changes that design, and offers
 * "Suggest with AI" only when a host lends a `SummarizationAssistant`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildNarrationScript } from '@bendyline/squisq/narration';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  PRESENTATION_LIMITS,
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
    await waitFor(() => expect(source.latest).toContain('"layout":"authored"'));
    // Only the frontmatter changes; the document text is left as written.
    expect(source.latest).toContain('North led every quarter.');
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
    expect(source.latest).toContain('"density":"section"');
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

  it('hides a slide by its passage, keeps one slide shown, and saves only a key', async () => {
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
    // Both keys are kept, so returning to Balanced hides its slide again.
    await waitFor(() =>
      expect(source.latest).toMatch(/"hidden":\["[0-9a-z]+-[0-9a-z]+","[0-9a-z]+-[0-9a-z]+"\]/),
    );
    expect(source.latest.match(/Each slide should carry/g)).toHaveLength(8);
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
    await waitFor(() => expect(source.latest).toContain('"density":"concise"'));
    expect(source.latest.endsWith(LONG)).toBe(true);

    // An undo in Write puts the document back. The designer follows it, and
    // does not write its own design back over it.
    act(() => source.set(LONG));
    await waitFor(() => expect(density().value).toBe('balanced'));
    expect(source.latest).toBe(LONG);
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
    await waitFor(() => expect(source.latest).toContain('A plan for March'));
    expect(slides()[0]!.textContent).toContain('A plan for March');
    expect(slides()[0]!.textContent).toContain('Suggested by AI');
    expect(report).toHaveBeenCalled();
    expect(report.mock.calls[report.mock.calls.length - 1]?.[0]).toContain('A plan for March');
    expect(screen.getByRole('button', { name: /^Report \d+$/ })).toBeTruthy();
  });
});
