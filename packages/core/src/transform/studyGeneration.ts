/**
 * Making study cards for a document's sections with a model.
 *
 * {@link generateStudyCards} goes through the sections one at a time and asks
 * for one kind of card per request — never two requests at once, since a
 * phone's model runs one at a time. A section longer than one request can
 * carry is split between sentences, each part asked for its share. Each
 * reply is read and judged (`studyAuthor.ts`); a request whose reply cannot
 * be used is repaired once (the JSON asked for again, half as many cards when
 * the reply was cut off with nothing finished, or the first refusal quoted).
 * Every accepted card is handed to `onCard` before the next request starts,
 * already a draft for `writeStudyCards`, marked as AI's and keyed to its
 * section's text — so stopping keeps every card made so far.
 */

import type { Doc } from '../schemas/Doc.js';
import { sectionPassages } from '../doc/sectionPassages.js';
import {
  readStudyCards,
  studyCardTextKey,
  type StudyCardKind,
} from '../doc/flashcards/studyCards.js';
import {
  studyCardDraftFromText,
  type StudyCardDraft,
  type StudyCardText,
} from '../doc/flashcards/studyCardsSource.js';
import {
  askAuthorModel,
  type AuthorModel,
  type AuthorModelReply,
  type AuthorModelRequest,
} from './authorModel.js';
import {
  STUDY_AUTHOR_LIMITS,
  judgeStudyCard,
  readStudyCardReply,
  studyBudget,
  studyCardCorrection,
  studyCardRequest,
  studyFormat,
  studyPrompt,
  type StudyModelLimits,
} from './studyAuthor.js';
import { addressesAModel } from './presentationAuthor.js';

/** One section to make cards for. */
export interface StudySection {
  blockId: string;
  heading?: string;
  /** Its own text (see `sectionPassages`). */
  text: string;
  /** Its passage key, recorded on each card made from it. */
  key: string;
  /** The questions its cards already ask, by kind. */
  questions: Record<StudyCardKind, string[]>;
}

/** Every section of a document that says something, with the questions its cards ask. */
export function studySectionsOf(doc: Doc): StudySection[] {
  const cards = readStudyCards(doc).cards;
  return sectionPassages(doc).map((passage) => ({
    blockId: passage.blockId,
    ...(passage.heading ? { heading: passage.heading } : {}),
    text: passage.text,
    key: passage.key,
    questions: {
      flashcard: cards
        .filter((card) => card.ownerId === passage.blockId && card.kind === 'flashcard')
        .map((card) => card.question),
      quiz: cards
        .filter((card) => card.ownerId === passage.blockId && card.kind === 'quiz')
        .map((card) => card.question),
    },
  }));
}

/** A request for study cards, as the host's transport receives it. */
export interface StudyModelRequest extends AuthorModelRequest {
  kind: 'flashcards' | 'quiz';
  /** The section the request is about. */
  blockId: string;
}

export type StudyModel = AuthorModel<StudyModelRequest>;

/** A card the model made and the gates accepted. */
export interface GeneratedStudyCard {
  ownerId: string;
  /** Ready for `writeStudyCards`: marked as AI's, keyed to its section's text. */
  draft: StudyCardDraft;
  /** The same card as plain text. */
  text: StudyCardText;
}

/** How one section and kind went. */
export interface StudySectionOutcome {
  blockId: string;
  kind: StudyCardKind;
  /** Cards asked for. */
  asked: number;
  accepted: number;
  /** Why the section was not sent, when it was not. */
  skipped?: 'too-short' | 'addresses-a-model';
}

export interface GenerateStudyCardsOptions {
  /** The kinds of card to make, each section in turn. */
  kinds: readonly StudyCardKind[];
  /** The model the host lends (its window, its reply cap). */
  limits?: StudyModelLimits;
  /** The document's title, for context. */
  title?: string;
  /** How many cards of a kind to make for a section (default: by its length). */
  countFor?: (section: StudySection, kind: StudyCardKind) => number;
  signal?: AbortSignal;
  /** `done` of `total` section-and-kind steps are finished; `active` is the one starting. */
  onProgress?: (
    done: number,
    total: number,
    active: { blockId: string; kind: StudyCardKind } | null,
  ) => void;
  /** Each accepted card, before the next request starts. */
  onCard?: (card: GeneratedStudyCard) => void;
  /** Each section and kind, once it is done. */
  onSection?: (outcome: StudySectionOutcome) => void;
  /** Each reply as it is read, with why cards were refused: for evaluations, not people. */
  onAttempt?: (
    blockId: string,
    kind: StudyCardKind,
    attempt: number,
    outcome: { text: string; problems: readonly string[]; notes: readonly string[] },
  ) => void;
}

export interface GenerateStudyCardsResult {
  /** Every accepted card, in the order made. */
  cards: GeneratedStudyCard[];
  sections: StudySectionOutcome[];
  /** Requests sent. */
  requests: number;
}

/** How many cards of a kind a section's text is worth by default. */
export function studyCardTarget(section: Pick<StudySection, 'text'>, kind: StudyCardKind): number {
  const length = section.text.length;
  return kind === 'quiz'
    ? Math.min(5, Math.max(1, Math.round(length / 600)))
    : Math.min(8, Math.max(1, Math.round(length / 400)));
}

/** A section's text in parts no longer than `limit`, split between sentences. */
function passageParts(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/gu) ?? [text];
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > limit) {
      parts.push(current.trim());
      current = '';
    }
    current += sentence.length > limit ? sentence.slice(0, limit) : sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Make study cards for `sections` (see the module comment). */
export async function generateStudyCards(
  sections: readonly StudySection[],
  model: StudyModel,
  options: GenerateStudyCardsOptions,
): Promise<GenerateStudyCardsResult> {
  const { signal } = options;
  const budget = studyBudget(options.limits);
  const result: GenerateStudyCardsResult = { cards: [], sections: [], requests: 0 };
  const steps = sections.flatMap((section) => options.kinds.map((kind) => ({ section, kind })));
  // Every question in the document, so no card repeats one anywhere.
  const existing = new Set(
    sections.flatMap((section) =>
      [...section.questions.flashcard, ...section.questions.quiz].map(studyCardTextKey),
    ),
  );

  for (const [done, { section, kind }] of steps.entries()) {
    signal?.throwIfAborted();
    options.onProgress?.(done, steps.length, { blockId: section.blockId, kind });
    const outcome: StudySectionOutcome = { blockId: section.blockId, kind, asked: 0, accepted: 0 };
    if (section.text.length < STUDY_AUTHOR_LIMITS.minimumCharacters) outcome.skipped = 'too-short';
    else if (addressesAModel(section.text)) outcome.skipped = 'addresses-a-model';
    if (outcome.skipped) {
      result.sections.push(outcome);
      options.onSection?.(outcome);
      continue;
    }

    const target = Math.max(
      0,
      Math.floor(options.countFor?.(section, kind) ?? studyCardTarget(section, kind)),
    );
    const parts = passageParts(section.text, budget.passageCharacters);
    const asked = [...section.questions[kind]];
    for (const [partIndex, passage] of parts.entries()) {
      // Each part asks for its share of what is still wanted.
      let wanted = Math.ceil((target - outcome.accepted) / (parts.length - partIndex));
      while (wanted > 0) {
        const count = Math.min(wanted, budget.cardsPerRequest[kind]);
        outcome.asked += count;
        const accepted = await requestCards({
          kind,
          count,
          passage,
          section,
          asked,
        });
        if (!accepted) break;
        outcome.accepted += accepted;
        wanted -= count;
        // A reply with fewer cards than asked means the passage has no more.
        if (accepted < count) break;
      }
    }
    result.sections.push(outcome);
    options.onSection?.(outcome);
  }
  options.onProgress?.(steps.length, steps.length, null);
  return result;

  /** One request and at most one repair; returns the cards accepted. */
  async function requestCards(request: {
    kind: StudyCardKind;
    count: number;
    passage: string;
    section: StudySection;
    asked: string[];
  }): Promise<number> {
    const { kind, section, passage } = request;
    let count = request.count;
    let correction: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const reply: AuthorModelReply = await askAuthorModel(
        model,
        {
          kind: kind === 'quiz' ? 'quiz' : 'flashcards',
          blockId: section.blockId,
          system: studyPrompt(kind),
          user: studyCardRequest({
            kind,
            count,
            passage,
            ...(section.heading ? { heading: section.heading } : {}),
            ...(options.title ? { title: options.title } : {}),
            avoid: request.asked,
            ...(correction ? { correction } : {}),
          }),
          responseFormat: studyFormat(kind),
          maxTokens: budget.replyTokens,
          temperature: STUDY_AUTHOR_LIMITS.temperature,
        },
        signal,
      );
      result.requests++;
      const read = readStudyCardReply(kind, reply.text);
      const problems: string[] = read.problem ? [read.problem] : [];
      const notes: string[] = [];
      let accepted = 0;
      for (const item of read.items.slice(0, count)) {
        const judged = judgeStudyCard(kind, item, {
          passage,
          ...(section.heading ? { heading: section.heading } : {}),
          existing,
        });
        if ('problem' in judged) {
          problems.push(judged.problem);
          continue;
        }
        notes.push(...judged.notes);
        const text: StudyCardText = { ...judged.card, origin: 'ai', passage: section.key };
        existing.add(studyCardTextKey(text.question));
        request.asked.push(text.question);
        const card = { ownerId: section.blockId, draft: studyCardDraftFromText(text), text };
        result.cards.push(card);
        options.onCard?.(card);
        accepted++;
      }
      options.onAttempt?.(section.blockId, kind, attempt, { text: reply.text, problems, notes });
      if (accepted > 0) return accepted;
      // Nothing usable: repair once.
      if (reply.truncated && !read.items.length) {
        count = Math.max(1, Math.floor(count / 2));
        correction = undefined;
      } else {
        correction = studyCardCorrection(problems[0] ?? 'It held no cards.', kind);
      }
    }
    return 0;
  }
}
