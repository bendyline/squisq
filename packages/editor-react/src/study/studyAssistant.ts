/**
 * The AI capability a host can lend the Study cards view.
 *
 * Squisq owns the view, the card format, what a model is asked and how its
 * replies are judged (`generateStudyCards` in `@bendyline/squisq/transform`).
 * A host only makes the calls, so it supplies this object — and without one
 * the view works fully, without AI.
 */
import type { ReactNode } from 'react';
import type {
  GeneratedStudyCard,
  StudyCardKind,
  StudySection,
  StudySectionOutcome,
} from '@bendyline/squisq/study';
import type { AssistantReadiness } from '../designer/useAssistantReadiness';

/** What to make cards for. */
export interface StudyCardsRequest {
  /** The sections, each with its text, passage key and the questions it already asks. */
  sections: StudySection[];
  /** The kinds of card to make for each section. */
  kinds: StudyCardKind[];
  /** The document's title, for context. */
  title?: string;
  /** How many cards of a kind each section should get, when the view decides (regenerating). */
  counts?: Record<string, Partial<Record<StudyCardKind, number>>>;
}

export interface GenerateStudyCardsCallbacks {
  /** Aborted when the person presses Stop or leaves the view. */
  signal: AbortSignal;
  /** `done` of `total` section-and-kind steps are finished; `active` is the one starting. */
  onProgress: (
    done: number,
    total: number,
    active: { blockId: string; kind: StudyCardKind } | null,
  ) => void;
  /** Each accepted card as soon as it resolves; the view saves it. */
  onCard: (card: GeneratedStudyCard) => void;
  /** Each section and kind once it is done; the view saves that section's cards then. */
  onSection?: (outcome: StudySectionOutcome) => void;
}

export interface StudyAssistant extends AssistantReadiness {
  /**
   * Make cards. Resolve when the run ends; reject with the signal's abort
   * error when stopped, or with an Error whose message the view shows. Most
   * hosts pass the request and callbacks to `generateStudyCards` with their
   * model transport and the model's limits.
   */
  generateCards: (
    request: StudyCardsRequest,
    callbacks: GenerateStudyCardsCallbacks,
  ) => Promise<void>;
  /** Optional control shown beside AI-written cards, such as a way to report them. */
  renderReport?: (output: string) => ReactNode;
  /** Optional detail shown beside the progress while cards are made (the model's own status). */
  renderActivity?: () => ReactNode;
}
