import { describe, expect, it } from 'vitest';
import { diffContextSections, type ZoneSpec } from '../codeContext/diffContextSections';

const spec = (id: string, line: number, ordinal = 0): ZoneSpec => ({ id, line, ordinal });

describe('diffContextSections', () => {
  it('adds everything on first sync', () => {
    const d = diffContextSections([], [spec('a', 1), spec('b', 5)]);
    expect(d.add.map((z) => z.id)).toEqual(['a', 'b']);
    expect(d.remove).toEqual([]);
    expect(d.move).toEqual([]);
  });

  it('is a no-op for identical specs', () => {
    const specs = [spec('a', 1, 1), spec('b', 5, 2)];
    const d = diffContextSections(
      specs,
      specs.map((s) => ({ ...s })),
    );
    expect(d.add).toEqual([]);
    expect(d.remove).toEqual([]);
    expect(d.move).toEqual([]);
  });

  it('moves when a line or ordinal changes, removes vanished ids', () => {
    const d = diffContextSections(
      [spec('a', 1, 1), spec('b', 5, 2), spec('c', 9, 3)],
      [spec('a', 2, 1), spec('b', 5, 4)],
    );
    expect(d.move.map((z) => z.id)).toEqual(['a', 'b']);
    expect(d.remove).toEqual(['c']);
    expect(d.add).toEqual([]);
  });

  it('duplicate ids in next: first occurrence wins, no double-add', () => {
    const d = diffContextSections([], [spec('a', 1), spec('a', 7)]);
    expect(d.add).toEqual([spec('a', 1)]);
  });
});
