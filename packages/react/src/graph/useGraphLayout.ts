/**
 * useGraphLayout — lay a graph out for `DiagramViewer`, off the render path.
 *
 * Results are cached by `graphSignature`, so returning to a graph seen
 * recently is instant. A layout superseded before it finishes is aborted;
 * with a worker engine that ends the worker's work too. While a new layout
 * is computing the previous one stays in place, and `slow` turns on only
 * when the wait is long enough to be worth showing.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  createInlineLayoutEngine,
  graphSignature,
  type GraphLayoutEngine,
  type LayoutGraph,
  type LayoutOptions,
  type LayoutResult,
} from '@bendyline/squisq-graph';

const CACHE_LIMIT = 12;
const cache = new Map<string, LayoutResult>();
let inlineEngine: GraphLayoutEngine | null = null;

function remember(signature: string, layout: LayoutResult): void {
  cache.delete(signature);
  cache.set(signature, layout);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

/** Forget every cached layout (tests, or after the engine version changes). */
export function clearGraphLayoutCache(): void {
  cache.clear();
}

export interface UseGraphLayoutOptions {
  /** Where layouts run; default the calling thread. Pass `createWorkerLayoutEngine()` for large graphs. */
  engine?: GraphLayoutEngine;
  /** How long a layout may take before `slow` turns on. Default 150 ms. */
  slowAfterMs?: number;
}

export interface GraphLayoutState {
  /** The layout for the current graph, or the previous one while it computes; null before the first. */
  layout: LayoutResult | null;
  /** True while the current graph's layout is still computing. */
  pending: boolean;
  /** True once a pending layout has taken longer than `slowAfterMs`. */
  slow: boolean;
  error: Error | null;
  signature: string | null;
}

interface Settled {
  signature: string | null;
  layout: LayoutResult | null;
  error: Error | null;
}

export function useGraphLayout(
  graph: LayoutGraph | null,
  options?: LayoutOptions,
  config: UseGraphLayoutOptions = {},
): GraphLayoutState {
  const signature = useMemo(
    () => (graph ? graphSignature(graph, options) : null),
    [graph, options],
  );
  const cached = signature ? cache.get(signature) : undefined;
  const [settled, setSettled] = useState<Settled>({ signature: null, layout: null, error: null });
  const [slow, setSlow] = useState(false);
  const { engine, slowAfterMs = 150 } = config;

  useEffect(() => {
    if (!graph || !signature) return;
    const hit = cache.get(signature);
    if (hit) {
      remember(signature, hit);
      setSettled({ signature, layout: hit, error: null });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => setSlow(true), slowAfterMs);
    const runner = engine ?? (inlineEngine ??= createInlineLayoutEngine());
    runner
      .layout(graph, options, { signal: controller.signal })
      .then(
        (layout) => {
          remember(signature, layout);
          if (!controller.signal.aborted) setSettled({ signature, layout, error: null });
        },
        (err: unknown) => {
          if (controller.signal.aborted) return;
          const error = err instanceof Error ? err : new Error(String(err));
          setSettled((prev) => ({ signature, layout: prev.layout, error }));
        },
      )
      .finally(() => {
        clearTimeout(timer);
        if (!controller.signal.aborted) setSlow(false);
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
      setSlow(false);
    };
    // The signature stands for the graph and options: a new object with the
    // same content must not lay out again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, engine, slowAfterMs]);

  const pending = signature !== null && !cached && settled.signature !== signature;
  return {
    layout: cached ?? settled.layout,
    pending,
    slow: pending && slow,
    error: !pending && settled.signature === signature ? settled.error : null,
    signature,
  };
}
