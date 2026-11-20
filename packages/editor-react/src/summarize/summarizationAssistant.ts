/**
 * The AI capability a host can lend the Custom summary designer.
 *
 * Squisq owns the designer: the slide list, layouts, wording, hiding, and the
 * saved `squisq-presentation-hints`. What a model is asked and how its replies
 * are judged is Squisq's too (`presentationAuthor` in
 * `@bendyline/squisq/transform`). A host only makes the calls, so it supplies
 * this object — and without one the designer simply has no "Suggest with AI".
 *
 * The contract is plain functions rather than React hooks, so a host can build
 * it once from whatever AI client it has and pass it to `EditorShell`'s
 * `summarizationAssistant`.
 */
import type { ReactNode } from 'react';
import type { PresentationBeat, PresentationPlan } from '@bendyline/squisq/transform';

export interface SuggestSlidesOptions {
  /** Aborted when the author presses Stop or leaves the designer. */
  signal: AbortSignal;
  /**
   * `completed` slides have resolved and a request for the next one is about
   * to start. Until the first call the designer says it is planning.
   */
  onProgress: (completed: number, total: number) => void;
  /**
   * One slide's outcome as soon as it resolves: the suggested slide, or null
   * when the automatic one is kept. The designer saves each suggestion as it
   * arrives, so stopping early keeps everything suggested so far.
   */
  onBeat: (index: number, beat: PresentationBeat | null) => void;
}

export interface SummarizationAssistant {
  /**
   * Whether suggestions can run now: null when they can, otherwise a sentence
   * saying why not (shown as the button's tooltip — "Turn on AI features in
   * Settings."). May answer asynchronously.
   */
  readiness: () => string | null | Promise<string | null>;
  /** Called whenever readiness may have changed; returns a function that stops listening. */
  onReadinessChange?: (listener: () => void) => () => void;
  /**
   * Suggest layouts and wording for the plan's slides. Resolve when the run
   * ends; reject with the signal's abort error when stopped, or with an Error
   * whose message the designer shows. Most hosts pass these options straight
   * to `wordPresentationPlan` (`@bendyline/squisq/transform`) with their model
   * transport, which runs Squisq's whole exchange.
   */
  suggestSlides: (plan: PresentationPlan, options: SuggestSlidesOptions) => Promise<void>;
  /**
   * Optional control shown beside the result of a run, such as a way to report
   * the AI's wording. Receives every AI-worded slide the design holds, as text.
   */
  renderReport?: (output: string) => ReactNode;
}
