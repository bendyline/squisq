/**
 * Whether a host-lent AI assistant can run now, kept current as the host
 * reports changes. Shared by the designers that offer AI (Summaries, Study
 * cards).
 */
import { useEffect, useState } from 'react';

/** What every host-lent assistant reports about itself. */
export interface AssistantReadiness {
  /** Null when it can run now, otherwise a sentence saying why not. */
  readiness: () => string | null | Promise<string | null>;
  /** Called whenever readiness may have changed; returns a function that stops listening. */
  onReadinessChange?: (listener: () => void) => () => void;
}

/** The assistant's readiness: undefined while checking, null when ready, else why not. */
export function useAssistantReadiness(assistant?: AssistantReadiness): string | null | undefined {
  const [reason, setReason] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!assistant) return;
    let live = true;
    setReason(undefined);
    const read = () => {
      Promise.resolve()
        .then(() => assistant.readiness())
        .then(
          (next) => {
            if (live) setReason(next);
          },
          (cause: unknown) => {
            if (live) setReason(cause instanceof Error ? cause.message : String(cause));
          },
        );
    };
    read();
    const stop = assistant.onReadinessChange?.(read);
    return () => {
      live = false;
      stop?.();
    };
  }, [assistant]);
  return reason;
}
