/**
 * Presentation wording — the loop that words a deck with a model.
 *
 * `presentationAuthor.ts` says what a model is asked and how each reply is
 * read. This runs the exchange: one request that plans every slide's layout
 * together (the storyboard, for a deck long enough to benefit and short enough
 * for a small model to see at once), then one request per slide, each retried
 * once with a correction that quotes what was wrong. Slides a model should not
 * word — an authored section, a hidden slide, a passage too long or one that
 * addresses the model — keep their automatic wording without being sent.
 *
 * The host supplies only the transport: a {@link PresentationModel} that sends
 * one request and returns the reply's text. Requests go one at a time — a
 * local model serves one anyway — and each slide is reported as soon as it
 * resolves, so a caller can show and save suggestions while the rest run.
 */

import {
  PRESENTATION_AUTHOR_LIMITS,
  PRESENTATION_SLIDE_FORMAT,
  PRESENTATION_STORYBOARD_FORMAT,
  presentationRetryContext,
  presentationSlidePrompt,
  presentationSlideRequest,
  presentationSlidesToWord,
  presentationStoryboardPrompt,
  presentationStoryboardRequest,
  presentationStoryboardTokens,
  presentationUsesStoryboard,
  readPresentationSlideReply,
  readPresentationStoryboardReply,
  type PresentationAuthorFormat,
  type PresentationSlideContext,
  type PresentationSlideReply,
} from './presentationAuthor.js';
import {
  isSummaryPresentationLayout,
  presentationBeatIsWorded,
  type PresentationBeat,
  type PresentationLayout,
  type PresentationPlan,
} from './presentationPlan.js';
import { askAuthorModel, type AuthorModelReply, type AuthorModelRequest } from './authorModel.js';

/**
 * One request to the model, in terms any chat API can carry — the shared
 * authoring transport (`authorModel.ts`), so one host function serves slide
 * wording and study cards alike.
 */
export interface PresentationModelRequest extends AuthorModelRequest {
  /** The deck's layouts planned together, or one slide's wording. */
  kind: 'storyboard' | 'slide';
  /** For a slide request, the beat it words. */
  index?: number;
  /** The reply shape, for a host that can enforce structured output (a JSON schema). */
  responseFormat: PresentationAuthorFormat;
}

/** The model's reply. `truncated` when it stopped at `maxTokens`. */
export type PresentationModelReply = AuthorModelReply;

/**
 * Sends one request and resolves with the reply. Throw to report a failure:
 * a failed storyboard only costs the deck its plan, a failed slide ends the
 * run with that error. Honor `signal`; the loop stops at the next request
 * either way.
 */
export type PresentationModel = (
  request: PresentationModelRequest,
  signal?: AbortSignal,
) => Promise<PresentationModelReply>;

export interface WordPresentationOptions {
  signal?: AbortSignal;
  /** `completed` slides have resolved and a request for the next one is about to start. */
  onProgress?: (completed: number, total: number) => void;
  /**
   * One slide's outcome, as soon as it resolves and before the next request
   * starts: the accepted beat, or null when the automatic version is kept.
   * Authored and hidden slides are never sent, so they have no outcome.
   */
  onBeat?: (index: number, beat: PresentationBeat | null) => void;
  /**
   * Each reply as it is read: why it was refused, or what was changed to keep
   * an accepted one faithful. For evaluations and diagnostics; an app shows
   * only outcomes.
   */
  onAttempt?: (
    index: number,
    attempt: number,
    outcome: { text: string; problem: string | null; notes: readonly string[] },
  ) => void;
}

export interface WordPresentationResult {
  /** The plan with every accepted slide in place; `origin` is `ai` when any was. */
  plan: PresentationPlan;
  /** Slides sent, or eligible, that kept their automatic wording. */
  retained: number;
  /** Indexes of the slides the model worded. */
  refined: number[];
}

/** One request; an abort while it was out is reported as the abort, not as its failure. */
const ask = askAuthorModel<PresentationModelRequest>;

/**
 * One request that plans every slide's layout together, so the deck varies
 * by design rather than slide by slide. Returns a layout for each beat the
 * model was asked about, or none when the reply does not name one layout per
 * slide, was cut off, or failed.
 */
async function storyboard(
  model: PresentationModel,
  plan: PresentationPlan,
  asked: readonly number[],
  signal: AbortSignal | undefined,
): Promise<Map<number, PresentationLayout>> {
  let reply: PresentationModelReply;
  try {
    reply = await ask(
      model,
      {
        kind: 'storyboard',
        system: presentationStoryboardPrompt(),
        user: presentationStoryboardRequest(plan, asked),
        responseFormat: PRESENTATION_STORYBOARD_FORMAT,
        maxTokens: presentationStoryboardTokens(asked.length),
        temperature: PRESENTATION_AUTHOR_LIMITS.temperature,
      },
      signal,
    );
  } catch (error: unknown) {
    if (signal?.aborted) throw error;
    return new Map();
  }
  if (reply.truncated) return new Map();
  return readPresentationStoryboardReply(reply.text, plan, asked);
}

/**
 * Word a deck with a model: plan its layouts together when that helps, then
 * word each slide, keeping the automatic slide wherever a reply is refused
 * twice. Rejects with the signal's reason when aborted, and with the model's
 * error when a slide request fails.
 */
export async function wordPresentationPlan(
  plan: PresentationPlan,
  model: PresentationModel,
  options: WordPresentationOptions = {},
): Promise<WordPresentationResult> {
  const { signal } = options;
  const beats = [...plan.beats];
  let retained = 0;
  const refined: number[] = [];
  // An authored section keeps its own block, a section shown on the slide
  // before it has no slide, and a hidden slide is not shown, so none has an
  // outcome. A passage too long for a small model, or one that addresses the
  // model, keeps its automatic slide without being sent.
  const considered = plan.beats.flatMap((beat, index) =>
    presentationBeatIsWorded(beat) ? [index] : [],
  );
  const asked = presentationSlidesToWord(plan);
  // A deck of a few slides plans its layouts together first; a short one, or
  // one too long for a small model to see at once, varies slide by slide.
  const planned = presentationUsesStoryboard(asked)
    ? await storyboard(model, plan, asked, signal)
    : new Map<number, PresentationLayout>();
  for (const index of plan.beats.keys()) {
    signal?.throwIfAborted();
    options.onProgress?.(index, plan.beats.length);
    if (!considered.includes(index)) continue;
    if (!asked.includes(index)) {
      retained++;
      options.onBeat?.(index, null);
      continue;
    }
    let replacement: PresentationBeat | null = null;
    // The layout planned for this slide with the whole deck in view; without
    // a plan, the deck so far, so the model can vary its layouts.
    let context: PresentationSlideContext = planned.has(index)
      ? { planned: planned.get(index) }
      : {
          previous: beats
            .slice(0, index)
            .filter((beat) => isSummaryPresentationLayout(beat.layout))
            .slice(-3)
            .map((beat) => beat.layout),
        };
    for (let attempt = 0; attempt < 2 && !replacement; attempt++) {
      const reply = await ask(
        model,
        {
          kind: 'slide',
          index,
          system: presentationSlidePrompt(),
          user: presentationSlideRequest(plan, index, context),
          responseFormat: PRESENTATION_SLIDE_FORMAT,
          maxTokens: PRESENTATION_AUTHOR_LIMITS.slideTokens,
          temperature: PRESENTATION_AUTHOR_LIMITS.temperature,
        },
        signal,
      );
      const read: PresentationSlideReply = reply.truncated
        ? {
            beat: null,
            problem: 'the reply was cut off before it finished',
            kind: 'reply',
            notes: [],
          }
        : readPresentationSlideReply(reply.text, plan, index);
      replacement = read.beat;
      options.onAttempt?.(index, attempt, {
        text: reply.text,
        problem: read.problem ?? null,
        notes: read.notes,
      });
      // The second request says what was wrong with the first, and stops
      // asking for a planned layout the passage could not fill.
      context = presentationRetryContext(context, read);
    }
    if (replacement) {
      beats[index] = replacement;
      refined.push(index);
    } else retained++;
    options.onBeat?.(index, replacement);
  }
  options.onProgress?.(plan.beats.length, plan.beats.length);
  return {
    plan: { ...plan, origin: refined.length ? 'ai' : plan.origin, beats },
    retained,
    refined,
  };
}
