import { describe, expect, it } from 'vitest';
import {
  createInlineLayoutEngine,
  createLocalLayoutTransport,
  createWorkerLayoutEngine,
} from '../engine.js';
import { layoutGraph } from '../layout.js';
import { graphSignature } from '../signature.js';
import type { LayoutGraph } from '../types.js';
import type { GraphWorkerTransport } from '../worker/protocol.js';

const graph: LayoutGraph = {
  nodes: [
    { id: 'a', width: 80, height: 30 },
    { id: 'b', width: 80, height: 30 },
    { id: 'c', width: 80, height: 30 },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'ac', source: 'a', target: 'c' },
  ],
};

describe('layout engines', () => {
  it('the inline engine answers what layoutGraph answers', async () => {
    const engine = createInlineLayoutEngine();
    expect(await engine.layout(graph, { direction: 'down' })).toEqual(
      layoutGraph(graph, { direction: 'down' }),
    );
    engine.dispose();
    await expect(engine.layout(graph)).rejects.toThrow(/dispose/);
  });

  it('the worker protocol gives the same answer as the calling thread', async () => {
    const engine = createWorkerLayoutEngine({ transport: createLocalLayoutTransport });
    expect(engine.mode).toBe('worker');
    expect(await engine.layout(graph)).toEqual(layoutGraph(graph));
    engine.dispose();
  });

  it('runs requests one at a time, in order', async () => {
    let posted = 0;
    const engine = createWorkerLayoutEngine({
      transport: () => {
        const inner = createLocalLayoutTransport();
        return { ...inner, post: (m) => (posted++, inner.post(m)) };
      },
    });
    const results = await Promise.all([
      engine.layout(graph, { direction: 'right' }),
      engine.layout(graph, { direction: 'down' }),
    ]);
    expect(posted).toBe(2);
    expect(results[0]).toEqual(layoutGraph(graph, { direction: 'right' }));
    expect(results[1]).toEqual(layoutGraph(graph, { direction: 'down' }));
    engine.dispose();
  });

  it('an abort ends the running worker and the next request starts a fresh one', async () => {
    let started = 0;
    let silentFirst = true;
    const engine = createWorkerLayoutEngine({
      transport: () => {
        started++;
        const inner = createLocalLayoutTransport();
        // The first worker never answers, like one stuck on a huge graph.
        if (silentFirst) {
          silentFirst = false;
          return { ...inner, post: () => undefined };
        }
        return inner;
      },
    });
    const controller = new AbortController();
    const stuck = engine.layout(graph, undefined, { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(stuck).rejects.toMatchObject({ name: 'AbortError' });
    expect(await engine.layout(graph)).toEqual(layoutGraph(graph));
    expect(started).toBe(2);
    engine.dispose();
  });

  it('a queued request can be aborted before it runs', async () => {
    const engine = createWorkerLayoutEngine({ transport: createLocalLayoutTransport });
    const controller = new AbortController();
    const first = engine.layout(graph);
    const second = engine.layout(graph, undefined, { signal: controller.signal });
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await expect(first).resolves.toBeDefined();
    engine.dispose();
  });

  it('times out a worker that never answers', async () => {
    const engine = createWorkerLayoutEngine({
      transport: () => ({ ...createLocalLayoutTransport(), post: () => undefined }),
      requestTimeoutMs: 20,
    });
    await expect(engine.layout(graph)).rejects.toThrow(/timed out/);
    engine.dispose();
  });

  it('falls back to the calling thread when the worker never loads', async () => {
    const failing = (): GraphWorkerTransport => {
      let fail: ((error: Error) => void) | undefined;
      return {
        post: () => queueMicrotask(() => fail?.(new Error('script 404'))),
        onMessage: () => undefined,
        onError: (fn) => {
          fail = fn;
        },
        terminate: () => undefined,
      };
    };
    const engine = createWorkerLayoutEngine({ transport: failing });
    expect(await engine.layout(graph)).toEqual(layoutGraph(graph));
    expect(engine.mode).toBe('inline');
    engine.dispose();
  });

  it('falls back to the calling thread where workers do not exist', async () => {
    const engine = createWorkerLayoutEngine();
    expect(await engine.layout(graph)).toEqual(layoutGraph(graph));
    expect(engine.mode).toBe('inline');
    engine.dispose();
  });

  it('dispose rejects whatever is still waiting', async () => {
    const engine = createWorkerLayoutEngine({
      transport: () => ({ ...createLocalLayoutTransport(), post: () => undefined }),
    });
    const pending = engine.layout(graph);
    await Promise.resolve();
    engine.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
  });
});

describe('graphSignature', () => {
  it('is stable for equal input and moves with anything that changes the layout', () => {
    const base = graphSignature(graph);
    expect(graphSignature(JSON.parse(JSON.stringify(graph)) as LayoutGraph)).toBe(base);
    expect(graphSignature(graph, { direction: 'down' })).not.toBe(base);
    expect(graphSignature(graph, { nodeSpacing: 20 })).toBe(base);
    expect(
      graphSignature({ ...graph, nodes: graph.nodes.map((n, i) => (i ? n : { ...n, width: 81 })) }),
    ).not.toBe(base);
    expect(graphSignature({ ...graph, edges: graph.edges.slice(1) })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });
});
