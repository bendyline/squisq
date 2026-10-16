import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Block, BuildCursor } from '@bendyline/squisq/schemas';
import { blockBuildSteps, buildSourceText } from '@bendyline/squisq/doc';

function identity(block: Block | null | undefined): string {
  return block
    ? `${block.id}:${JSON.stringify(block.build)}:${buildSourceText(blockBuildSteps(block))}`
    : '';
}

/** A manual build clock never seeks or starts the document's audio clock. */
export function useBuildNavigation(
  block: Block | null | undefined,
  enabled: boolean,
  motion: boolean,
) {
  const key = identity(block);
  const count = enabled && block ? blockBuildSteps(block).length : 0;
  const duration = motion ? Math.max(0, block?.build?.duration ?? 0.4) : 0;
  const [state, setState] = useState({ key: '', revealed: 0, progress: 1, started: 0 });
  const revealed = state.key === key ? Math.min(count, state.revealed) : 0;
  const progress = revealed > 0 && state.key === key ? state.progress : 1;
  useEffect(() => {
    if (!enabled || state.key !== key || state.progress >= 1) return;
    let frame = 0;
    const tick = (now: number) => {
      const next = duration === 0 ? 1 : Math.min(1, (now - state.started) / (duration * 1000));
      setState((current) =>
        current.key === key && current.started === state.started && current.progress < 1
          ? { ...current, progress: next }
          : current,
      );
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Progress updates must not restart the entrance clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, state.key, state.started, duration]);
  const next = useCallback(() => {
    if (revealed > 0 && progress < 1) {
      setState((current) => ({ ...current, progress: 1 }));
      return true;
    }
    if (revealed >= count) return false;
    const instant =
      duration === 0 ||
      block?.build?.effect === 'appear' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setState({
      key,
      revealed: revealed + 1,
      progress: instant ? 1 : 0,
      started: performance.now(),
    });
    return true;
  }, [key, revealed, progress, count, duration, block?.build?.effect]);
  const previous = useCallback(() => {
    if (!revealed) return false;
    setState({ key, revealed: revealed - 1, progress: 1, started: 0 });
    return true;
  }, [key, revealed]);
  const enter = useCallback((target: Block | null | undefined, complete = false) => {
    setState({
      key: identity(target),
      revealed: complete && target ? blockBuildSteps(target).length : 0,
      progress: 1,
      started: 0,
    });
  }, []);
  const showAll = useCallback(() => enter(block, true), [enter, block]);
  const cursor: BuildCursor = useMemo(() => ({ revealed, progress }), [revealed, progress]);
  return { cursor, count, next, previous, enter, showAll };
}
