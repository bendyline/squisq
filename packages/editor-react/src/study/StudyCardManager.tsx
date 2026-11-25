/**
 * The Study cards view's body: the document's sections with their cards
 * beside the selected section's cards, to add, edit, remove, keep and — with
 * a host's AI — generate.
 *
 * The document is the only copy of the cards (`{[flashcard]}` / `{[quiz]}`
 * blocks under each section): the view reads them from it on every change
 * and writes each change as it is made (`writeStudyCards`), one undo step
 * each, so an undo in Write, an edit in Source, or a card typed by hand flows
 * back here. Cards are addressed by their lasting key, so a save made while
 * AI is still adding cards cannot hit the wrong card.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { flattenContentBlocks, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  readStudyCards,
  sectionPassages,
  studyCardDraftFromMarkdown,
  studyCardDraftProblem,
  studySectionsOf,
  writeStudyCards,
  type GeneratedStudyCard,
  type StudyCard,
  type StudyCardChange,
  type StudyCardKind,
  type StudyCardText,
  type StudySection,
} from '@bendyline/squisq/study';
import { useEditorContext } from '../EditorContext';
import { useAssistantReadiness } from '../designer/useAssistantReadiness';
import { useBatchedSave } from '../designer/useBatchedSave';
import { AssistantRunControls } from '../designer/AssistantRunControls';
import { gist, sectionName } from '../designer/designerText';
import { StudyCardEditor } from './StudyCardEditor';
import { emptyStudyCardFields } from './studyCardFields';
import type { StudyAssistant } from './studyAssistant';

export interface StudyCardManagerProps {
  assistant?: StudyAssistant;
  readOnly?: boolean;
  /** Switch to studying the cards (Use › Flashcards). */
  onStudy?: () => void;
}

/** A section as the list shows it. */
interface SectionEntry {
  blockId: string;
  name: string;
  text: string;
  cards: StudyCard[];
}

/** What to make with AI. */
type MakeChoice = 'flashcard' | 'quiz' | 'both';
const KINDS_OF: Record<MakeChoice, StudyCardKind[]> = {
  flashcard: ['flashcard'],
  quiz: ['quiz'],
  both: ['flashcard', 'quiz'],
};
const COUNTED = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
const NO_SECTION = '\u0000none';

interface RunProgress {
  done: number;
  total: number;
  active: { blockId: string; kind: StudyCardKind } | null;
}

export function StudyCardManager({ assistant, readOnly = false, onStudy }: StudyCardManagerProps) {
  const { markdownSource, replaceAll } = useEditorContext();
  const pickerId = useId();
  const readiness = useAssistantReadiness(assistant);
  const sourceRef = useRef(markdownSource);
  sourceRef.current = markdownSource;
  const doc = useMemo(() => markdownToDoc(parseMarkdown(markdownSource)), [markdownSource]);
  const read = useMemo(() => readStudyCards(doc), [doc]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudyCardText | null>(null);
  const [make, setMake] = useState<MakeChoice>('flashcard');
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const running = progress !== null;
  const locked = running || readOnly;

  // Every section that says something or has cards, in document order.
  const sections = useMemo((): SectionEntry[] => {
    const passages = new Map(sectionPassages(doc).map((passage) => [passage.blockId, passage]));
    const byOwner = new Map<string, StudyCard[]>();
    for (const card of read.cards) {
      const owner =
        card.ownerId && flattenContentBlocks(doc.blocks).some((block) => block.id === card.ownerId)
          ? card.ownerId
          : NO_SECTION;
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), card]);
    }
    const entries: SectionEntry[] = [];
    for (const block of flattenContentBlocks(doc.blocks)) {
      const passage = passages.get(block.id);
      const cards = byOwner.get(block.id) ?? [];
      if (!passage && !cards.length) continue;
      entries.push({
        blockId: block.id,
        name: sectionName({
          heading: block.sourceHeading ? block.title : undefined,
          text: passage?.text,
        }),
        text: passage?.text ?? '',
        cards,
      });
    }
    const orphans = byOwner.get(NO_SECTION);
    if (orphans?.length)
      entries.push({
        blockId: NO_SECTION,
        name: 'Cards without a section',
        text: '',
        cards: orphans,
      });
    return entries;
  }, [doc, read.cards]);
  const selected = sections.find((entry) => entry.blockId === selectedId) ?? sections[0];
  const issuesOf = (card: StudyCard) => read.issues.filter((issue) => issue.cardKey === card.key);
  const toFix = (cards: readonly StudyCard[]) => cards.filter((card) => !card.usable).length;
  const toCheck = (cards: readonly StudyCard[]) => cards.filter((card) => card.stale).length;

  /** Write changes into the document, as one undo step; say what could not be written. */
  const commit = (changes: StudyCardChange[]) => {
    if (readOnly || !changes.length) return;
    const written = writeStudyCards(sourceRef.current, changes);
    if (written.result !== sourceRef.current) {
      sourceRef.current = written.result;
      replaceAll(written.result);
    }
    setError(written.rejected[0]?.message ?? null);
  };

  // Cards AI makes are saved a section at a time (and every few seconds on a slow model).
  const batch = useBatchedSave<GeneratedStudyCard>(
    (cards) =>
      commit(cards.map((card) => ({ op: 'add', ownerId: card.ownerId, card: card.draft }))),
    Infinity,
  );
  useEffect(() => () => controller.current?.abort(), []);

  /** Make cards with the host's AI; `replacing` cards are removed once their replacements are saved. */
  const generate = async (
    targets: StudySection[],
    kinds: StudyCardKind[],
    replacing: StudyCard[] = [],
  ) => {
    if (!assistant || controller.current || readOnly || !targets.length) return;
    const run = new AbortController();
    controller.current = run;
    setError(null);
    setNotice('');
    setProgress({ done: 0, total: targets.length * kinds.length, active: null });
    const made: GeneratedStudyCard[] = [];
    const counts: Record<string, Partial<Record<StudyCardKind, number>>> = {};
    for (const card of replacing) {
      const owner = card.ownerId ?? '';
      counts[owner] = { ...counts[owner], [card.kind]: (counts[owner]?.[card.kind] ?? 0) + 1 };
    }
    try {
      await assistant.generateCards(
        {
          sections: targets,
          kinds,
          ...(typeof doc.frontmatter?.title === 'string' ? { title: doc.frontmatter.title } : {}),
          ...(replacing.length ? { counts } : {}),
        },
        {
          signal: run.signal,
          onProgress: (done, total, active) => setProgress({ done, total, active }),
          onCard: (card) => {
            made.push(card);
            // Replacements are saved together with the removal of what they replace.
            if (!replacing.length) batch.add(card);
          },
          onSection: () => {
            if (!replacing.length) batch.flush();
          },
        },
      );
      run.signal.throwIfAborted();
      setNotice(
        made.length
          ? `${COUNTED(made.length, 'card was', 'cards were')} added. AI cards are marked; check them before you study.`
          : 'AI found nothing to add that the sections do not already ask.',
      );
    } catch (cause: unknown) {
      if (!run.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      else if (controller.current === run)
        setNotice(
          made.length
            ? `Stopped. The ${COUNTED(made.length, 'card', 'cards')} made so far ${made.length === 1 ? 'is' : 'are'} kept.`
            : 'Stopped. No cards were added.',
        );
    } finally {
      if (replacing.length) {
        // New cards first, then the old ones go, in one save; nothing goes if nothing came.
        if (made.length)
          commit([
            ...made.map((card): StudyCardChange => ({
              op: 'add',
              ownerId: card.ownerId,
              card: card.draft,
            })),
            ...replacing.map((card): StudyCardChange => ({ op: 'remove', key: card.key })),
          ]);
      } else {
        batch.flush();
      }
      if (controller.current === run) {
        controller.current = null;
        setProgress(null);
      }
    }
  };

  const studySections = () => studySectionsOf(markdownToDoc(parseMarkdown(sourceRef.current)));
  const generateHere = () => {
    if (!selected) return;
    void generate(
      studySections().filter((section) => section.blockId === selected.blockId),
      KINDS_OF[make],
    );
  };
  const emptyTargets = useMemo(
    () =>
      sections.filter(
        (entry) =>
          entry.text &&
          entry.blockId !== NO_SECTION &&
          KINDS_OF[make].every((kind) => !entry.cards.some((card) => card.kind === kind)),
      ),
    [make, sections],
  );
  const generateEverywhere = () => {
    const wanted = new Set(emptyTargets.map((entry) => entry.blockId));
    const skipped =
      sections.filter((entry) => entry.text && entry.blockId !== NO_SECTION).length - wanted.size;
    void generate(
      studySections().filter((section) => wanted.has(section.blockId)),
      KINDS_OF[make],
    ).then(() => {
      if (skipped > 0)
        setNotice((current) =>
          `${current} ${COUNTED(skipped, 'section that already has cards was', 'sections that already have cards were')} left as ${skipped === 1 ? 'it was' : 'they were'}.`.trim(),
        );
    });
  };
  const staleHere = selected?.cards.filter((card) => card.stale) ?? [];
  const regenerate = () => {
    if (!selected || !staleHere.length) return;
    const kinds = [...new Set(staleHere.map((card) => card.kind))];
    const stale = new Set(staleHere.map((card) => card.question));
    // The flagged cards' questions are not "already asked": they are being replaced.
    const targets = studySections()
      .filter((section) => section.blockId === selected.blockId)
      .map((section) => ({
        ...section,
        questions: {
          flashcard: section.questions.flashcard.filter((question) => !stale.has(question)),
          quiz: section.questions.quiz.filter((question) => !stale.has(question)),
        },
      }));
    void generate(targets, kinds, staleHere);
  };

  const saveNew = (fields: StudyCardText) => {
    if (!selected) return;
    const card = studyCardDraftFromMarkdown(fields);
    const problem = studyCardDraftProblem(card);
    if (problem) {
      setError(problem);
      return;
    }
    commit([{ op: 'add', ownerId: selected.blockId, card }]);
    setDraft(null);
  };

  const totalCards = read.cards.length;
  const status = [
    `${COUNTED(totalCards, 'card', 'cards')} in ${COUNTED(sections.filter((entry) => entry.cards.length).length, 'section', 'sections')}`,
    toCheck(read.cards) ? `${toCheck(read.cards)} to check` : '',
    toFix(read.cards) ? `${toFix(read.cards)} to fix` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const progressLabel = (() => {
    if (!progress) return '';
    const active =
      progress.active && sections.find((entry) => entry.blockId === progress.active!.blockId);
    if (!active) return 'Making cards…';
    return `Making ${progress.active!.kind === 'quiz' ? 'quiz questions' : 'flashcards'} for “${gist(active.name, 40)}”…`;
  })();
  const report =
    notice && !running && assistant?.renderReport && read.cards.some((card) => card.origin === 'ai')
      ? assistant.renderReport(
          read.cards
            .filter((card) => card.origin === 'ai')
            .map((card) => card.question)
            .join('\n'),
        )
      : null;

  if (!sections.length)
    return (
      <p className="squisq-study-empty" role="status">
        Write a section with some text, and its cards can be made here.
      </p>
    );

  return (
    <div className="squisq-study-cards">
      <p className="squisq-study-status" role="status" aria-live="polite">
        {status}
      </p>
      {error && (
        <p className="squisq-study-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="squisq-study-status" role="status">
          {notice}
          {report && <> {report}</>}
        </p>
      )}
      <div className="squisq-study-workspace">
        <nav className="squisq-study-sections" aria-label="Sections">
          {sections.map((entry) => {
            const writing = progress?.active?.blockId === entry.blockId;
            return (
              <button
                key={entry.blockId}
                type="button"
                aria-current={entry === selected ? 'true' : undefined}
                onClick={() => {
                  setSelectedId(entry.blockId);
                  setDraft(null);
                }}
              >
                <span className="squisq-study-section-name">{entry.name}</span>
                <span className="squisq-study-section-tags">
                  <small>{COUNTED(entry.cards.length, 'card', 'cards')}</small>
                  {toCheck(entry.cards) > 0 && (
                    <small className="squisq-study-tag--warn">
                      {toCheck(entry.cards)} to check
                    </small>
                  )}
                  {toFix(entry.cards) > 0 && (
                    <small className="squisq-study-tag--warn">{toFix(entry.cards)} to fix</small>
                  )}
                  {writing && <small>Writing…</small>}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="squisq-study-picker">
          <label htmlFor={pickerId}>Section</label>
          <select
            id={pickerId}
            value={selected?.blockId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setDraft(null);
            }}
          >
            {sections.map((entry) => (
              <option key={entry.blockId} value={entry.blockId}>
                {`${entry.name} · ${COUNTED(entry.cards.length, 'card', 'cards')}`}
              </option>
            ))}
          </select>
        </div>
        {selected && (
          <section className="squisq-study-detail" aria-label={`Cards for ${selected.name}`}>
            <h3 className="squisq-study-detail-title">{selected.name}</h3>
            {selected.text && <p className="squisq-study-passage">{gist(selected.text, 360)}</p>}
            {staleHere.length > 0 && (
              <div className="squisq-study-flag" role="note">
                <p>
                  This section’s text changed after AI wrote{' '}
                  {staleHere.length === 1 ? 'one of its cards' : `${staleHere.length} of its cards`}
                  . Check {staleHere.length === 1 ? 'it is' : 'they are'} still right.
                </p>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => commit(staleHere.map((card) => ({ op: 'keep', key: card.key })))}
                >
                  Keep all
                </button>
                {assistant && (
                  <button
                    type="button"
                    disabled={locked || readiness !== null}
                    onClick={regenerate}
                  >
                    Regenerate
                  </button>
                )}
              </div>
            )}
            {selected.cards.length === 0 && !draft && (
              <p className="squisq-study-none">This section has no cards yet.</p>
            )}
            {selected.cards.map((card, at) => (
              <StudyCardEditor
                key={card.key}
                card={card}
                index={at + 1}
                issues={issuesOf(card)}
                disabled={locked}
                onChange={(fields) =>
                  commit([
                    { op: 'update', key: card.key, card: studyCardDraftFromMarkdown(fields) },
                  ])
                }
                onRemove={() => commit([{ op: 'remove', key: card.key }])}
                onKeep={() => commit([{ op: 'keep', key: card.key }])}
              />
            ))}
            {draft && (
              <StudyCardEditor
                initial={draft}
                index={selected.cards.length + 1}
                disabled={locked}
                onSaveNew={saveNew}
                onCancelNew={() => setDraft(null)}
              />
            )}
            {selected.blockId !== NO_SECTION && !draft && (
              <div className="squisq-study-add">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setDraft(emptyStudyCardFields('flashcard'))}
                >
                  Add flashcard
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setDraft(emptyStudyCardFields('quiz'))}
                >
                  Add quiz question
                </button>
                {onStudy && totalCards > 0 && (
                  <button type="button" onClick={onStudy}>
                    Study these cards
                  </button>
                )}
              </div>
            )}
            {assistant && selected.blockId !== NO_SECTION && (
              <div className="squisq-study-generate">
                <label>
                  Make
                  <select
                    value={make}
                    disabled={locked}
                    onChange={(event) => setMake(event.target.value as MakeChoice)}
                  >
                    <option value="flashcard">Flashcards</option>
                    <option value="quiz">Quiz questions</option>
                    <option value="both">Both</option>
                  </select>
                </label>
                <AssistantRunControls
                  label="Generate for this section"
                  title="Write cards for this section from its text."
                  readiness={readiness}
                  disabled={!selected.text}
                  readOnly={readOnly}
                  progress={
                    progress && {
                      label: progressLabel,
                      done: progress.done,
                      total: progress.total,
                      measure: 'Sections done so far',
                    }
                  }
                  stopTitle="Stop making cards. Cards already made are kept."
                  onStart={generateHere}
                  onStop={() => controller.current?.abort()}
                  activity={assistant.renderActivity?.()}
                />
                {!running && (
                  <button
                    type="button"
                    disabled={readiness !== null || readOnly || !emptyTargets.length}
                    title={
                      emptyTargets.length
                        ? 'Write cards for every section that has none of this kind.'
                        : 'Every section already has cards of this kind.'
                    }
                    onClick={generateEverywhere}
                  >
                    Generate for all sections without cards
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
