/**
 * Review state distribution.
 *
 * `ReviewRoot` sits INSIDE `EditorProvider` and wraps the shell body, the same
 * shape as `ProofingRoot`: children pass through with stable identity, so a
 * review pass re-renders only review consumers and never the editors
 * themselves. A pass can take seconds, and re-rendering an editor on each one
 * would be felt.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useReview, type ReviewState } from './useReview.js';
import type { ReviewCapability } from './types.js';

const ReviewStateContext = createContext<ReviewState | null>(null);

/** Review state, or `null` when the host injected no providers. */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider, mirroring ProofingContext
export function useReviewState(): ReviewState | null {
  return useContext(ReviewStateContext);
}

export function ReviewRoot({
  providers,
  children,
}: {
  providers?: readonly ReviewCapability[];
  children: ReactNode;
}): JSX.Element {
  const state = useReview(providers);
  return <ReviewStateContext.Provider value={state}>{children}</ReviewStateContext.Provider>;
}
