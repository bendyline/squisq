/**
 * The review capability contract between an editor host and the shell.
 *
 * A host passes providers to `EditorShell`'s `reviewProviders` prop, the same
 * capability-injection semantics as `proofing`: absent means the feature is
 * off and nothing is loaded. Unlike `proofing` this is a list, because the
 * providers are independent — a spellchecker and a document reviewer disagree
 * about latency, about what a suggestion is, and about which hue they draw in,
 * and a host should be able to run either without the other.
 *
 * The surface is plain data end to end, so a provider can be an engine in the
 * page, a call to a local service, or a test fake.
 */

import type { ReviewEvent, ReviewRequest } from '@bendyline/squisq/review';

/**
 * Which hue a provider's findings draw in.
 *
 * Named rather than free-form so the palette stays a theme decision. The first
 * three are proofing's existing colours; `assist` is the fourth, for a provider
 * whose findings are suggestions rather than mistakes.
 */
export type ReviewHue = 'spelling' | 'grammar' | 'style' | 'assist';

export interface ReviewProvider {
  /**
   * Stable namespace, e.g. `harper`. Prefixes decoration keys and groups the
   * panel, so two providers reporting the same span never collide.
   */
  readonly id: string;
  /** Shown as the panel group header and in the status segment. */
  readonly label: string;
  /** Defaults to `style`. */
  readonly hue?: ReviewHue;
  /**
   * Idle delay before this provider runs, in milliseconds.
   *
   * Per provider because the right answer differs by an order of magnitude:
   * a local spellchecker can re-run 450 ms after a keystroke, while a model
   * that takes seconds and owns the device's accelerator should not. Defaults
   * to a conservative value rather than to proofing's.
   */
  readonly debounceMs?: number;
  /**
   * Prepare the provider. Idempotent, retryable, and where all expensive work
   * belongs. A rejection is not fatal: the editor reports the provider as
   * unavailable and keeps the others running.
   */
  setup?(): Promise<void>;
  /**
   * Review a document.
   *
   * Streaming and cancellable, which is the whole reason this is not `lint`.
   * The editor aborts the signal as soon as the document changes, and a
   * provider must stop promptly rather than finish and return stale findings.
   */
  review(request: ReviewRequest, signal: AbortSignal): AsyncIterable<ReviewEvent>;
  /**
   * Persistently dismiss a finding. Optional: a provider with no notion of
   * "don't tell me again" simply omits it and the editor hides the action.
   */
  dismissFinding?(findingId: string): Promise<void>;
  /** Release resources. Further calls may reject. */
  dispose?(): void;
}

/**
 * Deferred construction. A factory's provider is created on first activation
 * and disposed on unmount; a host that passes an instance owns its lifetime,
 * which is what lets one warm engine survive shell remounts.
 */
export type ReviewProviderFactory = () => ReviewProvider;

/** What each entry of the `reviewProviders` shell prop accepts. */
export type ReviewCapability = ReviewProvider | ReviewProviderFactory;

/** Resolve a capability to a provider instance. */
export function resolveReviewProvider(capability: ReviewCapability): ReviewProvider {
  return typeof capability === 'function' ? capability() : capability;
}

/** The delay a provider gets when it does not ask for one. */
export const DEFAULT_REVIEW_DEBOUNCE_MS = 2_000;

/** The hue a provider draws in when it does not ask for one. */
export const DEFAULT_REVIEW_HUE: ReviewHue = 'style';
