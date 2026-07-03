/**
 * bezierEdit — parse/serialize round-trip and editing operations.
 */

import { describe, it, expect } from 'vitest';
import { parsePath, serializePath, moveAnchor, moveHandle } from '../paths/bezierEdit';

describe('parsePath / serializePath', () => {
  it('parses an M then L sequence', () => {
    const p = parsePath('M 10 20 L 30 40');
    expect(p.points).toEqual([
      { kind: 'move', x: 10, y: 20 },
      { kind: 'line', x: 30, y: 40 },
    ]);
    expect(p.closed).toBe(false);
  });

  it('treats implicit pairs after M as L commands', () => {
    const p = parsePath('M 0 0 10 10 20 20');
    expect(p.points.map((q) => q.kind)).toEqual(['move', 'line', 'line']);
    expect(p.points[2]).toMatchObject({ x: 20, y: 20 });
  });

  it('parses a cubic curve and attaches handles to the surrounding anchors', () => {
    const p = parsePath('M 0 0 C 10 0 90 100 100 100');
    expect(p.points).toHaveLength(2);
    const m = p.points[0];
    const c = p.points[1];
    expect(m.cpOut).toEqual({ x: 10, y: 0 });
    expect(c.cpIn).toEqual({ x: 90, y: 100 });
    expect(c).toMatchObject({ kind: 'curve', x: 100, y: 100 });
  });

  it('captures Z as closed', () => {
    const p = parsePath('M 0 0 L 10 0 L 10 10 Z');
    expect(p.closed).toBe(true);
  });

  it('round-trips M/L/C/Z paths via serialize ∘ parse', () => {
    const d = 'M 0 0 C 20 0 80 100 100 100 L 100 200 Z';
    const round = serializePath(parsePath(d));
    expect(round).toBe(d);
  });

  it('skips unknown commands without throwing', () => {
    const p = parsePath('M 0 0 A 50 50 0 1 0 100 0 L 100 100');
    // The A is dropped (unsupported), but the subsequent L survives — though
    // its anchor sits where the parser was when A's args were skipped.
    // Verify we got the M and at least one L without crashing.
    expect(p.points[0]).toMatchObject({ kind: 'move' });
    expect(p.points.some((q) => q.kind === 'line')).toBe(true);
  });
});

describe('moveAnchor', () => {
  it('shifts the anchor and its handles by the same delta', () => {
    const path = parsePath('M 0 0 C 10 0 90 100 100 100');
    const moved = moveAnchor(path, 1, 5, 5);
    const c = moved.points[1];
    expect(c).toMatchObject({ x: 105, y: 105 });
    // Incoming handle moves with the anchor.
    expect(c.cpIn).toEqual({ x: 95, y: 105 });
  });

  it('does not mutate the input', () => {
    const path = parsePath('M 0 0 L 10 10');
    const before = JSON.stringify(path);
    moveAnchor(path, 1, 100, 100);
    expect(JSON.stringify(path)).toBe(before);
  });

  it('is a no-op for an out-of-range index', () => {
    const path = parsePath('M 0 0 L 10 10');
    const result = moveAnchor(path, 99, 5, 5);
    expect(result).toEqual(path);
  });
});

describe('moveHandle', () => {
  it('replaces a single control-point handle', () => {
    const path = parsePath('M 0 0 C 10 0 90 100 100 100');
    const out = moveHandle(path, 1, 'cpIn', 200, 200);
    expect(out.points[1].cpIn).toEqual({ x: 200, y: 200 });
  });
});
