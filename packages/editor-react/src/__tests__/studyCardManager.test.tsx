/**
 * @vitest-environment jsdom
 *
 * The Study cards view (Write › Study cards): the document's sections with
 * their cards, each change written into the document as it is made — adding,
 * editing, removing and keeping cards — and Generate when a host lends AI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { passageKey, readStudyCards, studyCardDraftFromText } from '@bendyline/squisq/study';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildNarrationScript } from '@bendyline/squisq/narration';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { StudyCardManager } from '../study/StudyCardManager';
import type { StudyAssistant } from '../study/studyAssistant';

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

const source = { latest: '' };
function SourceProbe() {
  source.latest = useEditorContext().markdownSource;
  return null;
}

const PLANTS = 'Plants turn light into sugar in their leaves. The leaves hold chlorophyll.';
const DOC = [
  '## Plants',
  '',
  PLANTS,
  '',
  `### What do leaves hold? {[flashcard origin=ai passage=${passageKey(PLANTS)}]}`,
  '',
  'Chlorophyll.',
  '',
  '## Water',
  '',
  'Roots drink water from the soil.',
].join('\n');

function renderManager(markdown = DOC, props: Parameters<typeof StudyCardManager>[0] = {}) {
  return render(
    <EditorProvider initialMarkdown={markdown}>
      <SourceProbe />
      <StudyCardManager {...props} />
    </EditorProvider>,
  );
}

const sections = () =>
  within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button');
const cards = () => readStudyCards(markdownToDoc(parseMarkdown(source.latest))).cards;

describe('StudyCardManager', () => {
  it('lists the sections with their cards and writes nothing on open', async () => {
    renderManager();
    await waitFor(() => expect(sections()).toHaveLength(2));
    expect(sections()[0]!.textContent).toContain('Plants');
    expect(sections()[0]!.textContent).toContain('1 card');
    expect(sections()[1]!.textContent).toContain('0 cards');
    expect(screen.getAllByRole('status')[0]!.textContent).toBe('1 card in 1 section');
    expect(source.latest).toBe(DOC);
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveProperty(
      'value',
      'What do leaves hold?',
    );
  });

  it('adds a flashcard and a quiz question, saving only a complete card', async () => {
    renderManager();
    await waitFor(() => expect(sections()).toHaveLength(2));
    fireEvent.click(sections()[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add flashcard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    expect(screen.getByRole('alert').textContent).toBe('A card needs a question.');
    expect(source.latest).toBe(DOC);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
      target: { value: 'What do roots drink?' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), {
      target: { value: 'Water from the *soil*.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await waitFor(() =>
      expect(source.latest).toContain(
        '### What do roots drink? {[flashcard]}\n\nWater from the *soil*.',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add quiz question' }));
    const form = screen.getByRole('article', { name: 'New quiz question' });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Question' }), {
      target: { value: 'Where does water come from?' },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Choice 1' }), {
      target: { value: 'The sky' },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Choice 2' }), {
      target: { value: 'The soil' },
    });
    fireEvent.click(within(form).getByRole('radio', { name: 'Choice 2 is the right answer' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(source.latest).toContain('- [ ] The sky\n- [x] The soil'));
    expect(cards().map((card) => [card.kind, card.ownerId, card.usable])).toEqual([
      ['flashcard', 'plants', true],
      ['flashcard', 'water', true],
      ['quiz', 'water', true],
    ]);
  });

  it('saves an edited field when it is left, and the edited card is no longer AI’s', async () => {
    renderManager();
    const answer = await screen.findByRole('textbox', { name: 'Answer' });
    fireEvent.change(answer, { target: { value: 'Chlorophyll, which catches light.' } });
    fireEvent.blur(answer);
    await waitFor(() =>
      expect(source.latest).toContain(
        '### What do leaves hold? {[flashcard]}\n\nChlorophyll, which catches light.',
      ),
    );
    expect(cards()[0]!.origin).toBeUndefined();
    // Leaving a field unchanged saves nothing.
    const before = source.latest;
    fireEvent.blur(screen.getByRole('textbox', { name: 'Question' }));
    expect(source.latest).toBe(before);
  });

  it('removes a card', async () => {
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove card' }));
    await waitFor(() => expect(cards()).toEqual([]));
    expect(source.latest).not.toContain('{[flashcard');
  });

  it('flags AI cards whose section changed, and Keep all clears the flag', async () => {
    renderManager(DOC.replace(PLANTS, `${PLANTS} They need water too.`));
    expect(await screen.findByText(/text changed after AI wrote one of its cards/)).toBeTruthy();
    expect(sections()[0]!.textContent).toContain('1 to check');
    fireEvent.click(screen.getByRole('button', { name: 'Keep all' }));
    await waitFor(() => expect(cards()[0]).toMatchObject({ stale: false, origin: 'ai' }));
    expect(screen.queryByText(/text changed after AI wrote/)).toBeNull();
  });

  it('offers no AI without an assistant, and changes nothing when read-only', async () => {
    renderManager();
    await screen.findByRole('textbox', { name: 'Question' });
    expect(screen.queryByRole('button', { name: 'Generate for this section' })).toBeNull();
    cleanup();
    renderManager(DOC, { readOnly: true });
    expect(
      ((await screen.findByRole('textbox', { name: 'Question' })) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Add flashcard' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('generates cards for a section, saving them as they come, and never changes what is narrated', async () => {
    const assistant: StudyAssistant = {
      readiness: () => null,
      generateCards: vi.fn<StudyAssistant['generateCards']>(async (request, callbacks) => {
        expect(request.sections.map((section) => section.blockId)).toEqual(['water']);
        expect(request.kinds).toEqual(['flashcard']);
        const section = request.sections[0]!;
        callbacks.onProgress(0, 1, { blockId: 'water', kind: 'flashcard' });
        const text = {
          kind: 'flashcard' as const,
          question: 'What do roots drink?',
          answer: 'Water from the soil.',
          origin: 'ai' as const,
          passage: section.key,
        };
        callbacks.onCard({ ownerId: 'water', draft: studyCardDraftFromText(text), text });
        callbacks.onSection?.({ blockId: 'water', kind: 'flashcard', asked: 2, accepted: 1 });
        callbacks.onProgress(1, 1, null);
      }),
    };
    renderManager(DOC, { assistant });
    await waitFor(() => expect(sections()).toHaveLength(2));
    fireEvent.click(sections()[1]!);
    const generate = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Generate for this section',
    });
    await waitFor(() => expect(generate.disabled).toBe(false));
    fireEvent.click(generate);
    await waitFor(() =>
      expect(cards().map((card) => card.question)).toContain('What do roots drink?'),
    );
    expect(cards().find((card) => card.ownerId === 'water')).toMatchObject({
      origin: 'ai',
      stale: false,
    });
    expect(await screen.findByText(/1 card was added/)).toBeTruthy();
    const narration = (text: string) =>
      buildNarrationScript(markdownToDoc(parseMarkdown(text))).sourceText;
    expect(narration(source.latest)).toBe(narration(DOC));
  });

  it('keeps the flagged cards when regenerating them fails', async () => {
    const assistant: StudyAssistant = {
      readiness: () => null,
      generateCards: async () => {
        throw new Error('The model is not running.');
      },
    };
    const changed = DOC.replace(PLANTS, `${PLANTS} They need water too.`);
    renderManager(changed, { assistant });
    const regenerate = await screen.findByRole<HTMLButtonElement>('button', { name: 'Regenerate' });
    await waitFor(() => expect(regenerate.disabled).toBe(false));
    fireEvent.click(regenerate);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The model is not running.',
    );
    expect(source.latest).toBe(changed);
  });
});
