/**
 * Run a proofing engine as a review provider.
 *
 * This is what keeps there from being two pipelines. Proofing predates review
 * and has the narrower contract — one flat string in, a whole array out, no
 * cancellation — so the adapter owns the difference: it joins the blocks the
 * way proofing's own orchestration does, lints once, and maps each finding back
 * to the block it came from.
 *
 * Linting the joined text rather than block by block is deliberate. A grammar
 * engine reads across a paragraph boundary, and a per-block call would lose
 * every finding that spans one.
 */

import {
  buildJoinedText,
  mapJoinedSpanToSegment,
  type ProofFinding,
} from '@bendyline/squisq/proof';
import { PROOFING_REVIEW_SOURCE, proofFindingToReviewFinding } from '@bendyline/squisq/review';
import type { ReviewEvent, ReviewFinding, ReviewRequest } from '@bendyline/squisq/review';
import type { ProofingProvider } from '../proofing/types.js';
import type { ReviewHue, ReviewProvider } from './types.js';

export interface ProofingReviewAdapterOptions {
  /** Namespace for the findings. Defaults to `harper`. */
  id?: string;
  label?: string;
  hue?: ReviewHue;
  /** Proofing is cheap enough to re-run shortly after a keystroke. */
  debounceMs?: number;
}

/** The idle delay proofing has always used. */
export const PROOFING_DEBOUNCE_MS = 450;

/**
 * Adapt a {@link ProofingProvider} to the review contract.
 *
 * The adapter does not own the provider's lifetime: a host that passed an
 * instance keeps its warm engine across shell remounts, exactly as before.
 * Only a provider the adapter constructed is disposed by it.
 */
export function createProofingReviewProvider(
  provider: ProofingProvider,
  options: ProofingReviewAdapterOptions = {},
): ReviewProvider {
  const id = options.id ?? PROOFING_REVIEW_SOURCE;
  return {
    id,
    label: options.label ?? 'Spelling and grammar',
    hue: options.hue ?? 'spelling',
    debounceMs: options.debounceMs ?? PROOFING_DEBOUNCE_MS,
    setup: () => provider.setup(),
    review: (request, signal) => reviewWithProofing(provider, id, request, signal),
    dismissFinding: (findingId) => provider.ignoreFinding(findingId),
  };
}

async function* reviewWithProofing(
  provider: ProofingProvider,
  id: string,
  request: ReviewRequest,
  signal: AbortSignal,
): AsyncIterable<ReviewEvent> {
  if (request.blocks.length === 0) {
    yield { type: 'done' };
    return;
  }
  if (signal.aborted) return;

  const joined = buildJoinedText(request.blocks.map((block) => block.text));

  let findings: ProofFinding[];
  try {
    findings = await provider.lint(joined.text, { language: request.language ?? 'plaintext' });
  } catch (error) {
    // A provider that cannot lint is not a broken editor: report it and let
    // the other providers carry on.
    yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
    return;
  }

  // The document moved while the engine was working, so these findings are
  // about text that no longer exists. Dropping them is what stops a squiggle
  // landing on an unrelated word.
  if (signal.aborted) return;

  const mapped: ReviewFinding[] = [];
  for (const finding of findings) {
    const span = mapJoinedSpanToSegment(joined, finding.start, finding.end);
    // A finding straddling the separator belongs to no single block. It is
    // an artefact of joining, not something the author wrote.
    if (!span) continue;
    const block = request.blocks[span.segmentIndex];
    if (!block) continue;
    mapped.push(
      proofFindingToReviewFinding(
        { ...finding, start: span.start, end: span.end },
        { source: id, offset: block.offset, blockKey: block.key },
      ),
    );
  }

  yield { type: 'findings', findings: mapped };
  yield { type: 'done' };
}
