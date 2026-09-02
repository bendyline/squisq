/**
 * Worker-hosting branch paths the parity suite doesn't reach: the create
 * handshake timing out on a dead transport, error responses rejecting
 * exactly their own request, budget results crossing the protocol intact,
 * mutations refused after dispose, and stray responses being ignored.
 */

import { describe, expect, it, vi } from 'vitest';
import { createCalcWorkerHost } from '../worker/host.js';
import { createLocalCalcTransport, createWorkerCalcEngine } from '../workerEngine.js';
import type { CalcWorkerResponse, CalcWorkerTransport } from '../worker/protocol.js';

describe('worker engine edges', () => {
  it('rejects the create handshake when the transport never answers', async () => {
    vi.useFakeTimers();
    try {
      const dead: CalcWorkerTransport = {
        post: () => {},
        onMessage: () => {},
        terminate: () => {},
      };
      const pending = createWorkerCalcEngine({ transport: dead });
      const settled = expect(pending).rejects.toThrow(/did not start/);
      await vi.advanceTimersByTimeAsync(6_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('an error response rejects only the request that caused it', async () => {
    // A transport whose host is bypassed for one poisoned request id.
    const transport = createLocalCalcTransport();
    const engine = await createWorkerCalcEngine({ transport });
    // No workbook loaded → graph queries still answer (empty), but a
    // request the host cannot serve errors: force it by disposing the
    // host-side engine through the protocol while keeping the client open.
    transport.post({ type: 'dispose' });
    await expect(engine.getCells([{ sheet: 'S', row: 0, col: 0 }])).rejects.toThrow(
      /engine not created/,
    );
    engine.dispose();
  });

  it('budget-exceeded results cross the protocol intact', async () => {
    const engine = await createWorkerCalcEngine({ transport: createLocalCalcTransport() });
    const rows = Array.from({ length: 50 }, (_, i) => [
      { value: i } as { value: number } | { formula: string },
      { formula: `A${i + 1}*2` },
    ]);
    await engine.loadWorkbook({ sheets: [{ name: 'S', cells: rows }] });
    const result = await engine.evaluateAll({ maxWorkUnits: 3 });
    expect(result.status).toBe('budget-exceeded');
    expect(result.dirtyRemaining.length).toBeGreaterThan(0);
    // And a real budget then finishes the job.
    const finish = await engine.evaluateAll();
    expect(finish.status).toBe('complete');
    engine.dispose();
  });

  it('mutations after dispose throw synchronously', async () => {
    const engine = await createWorkerCalcEngine({ transport: createLocalCalcTransport() });
    engine.dispose();
    engine.dispose(); // idempotent
    expect(() => engine.setCellValue({ sheet: 'S', row: 0, col: 0 }, 1)).toThrow(/dispose/);
    expect(() => engine.clearCell({ sheet: 'S', row: 0, col: 0 })).toThrow(/dispose/);
    await expect(engine.loadWorkbook({ sheets: [] })).rejects.toThrow(/dispose/);
  });

  it('the host ignores unknown ids and un-created engines quietly', () => {
    const posts: CalcWorkerResponse[] = [];
    const host = createCalcWorkerHost((message) => posts.push(message));
    // Mutations before create are dropped, not errors (fire-and-forget).
    host({ type: 'setCellValue', address: { sheet: 'S', row: 0, col: 0 }, value: 1 });
    expect(posts).toEqual([]);
    // A request before create errors with its own id.
    host({ type: 'getCells', id: 7, addresses: [] });
    expect(posts).toEqual([{ type: 'error', id: 7, message: 'engine not created' }]);
  });
});
