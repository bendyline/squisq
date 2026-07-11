import { describe, expect, it } from 'vitest';
import type { DiagramEdge, DiagramNode, EditorShellProps } from '../index';

// @ts-expect-error React Flow-prefixed types were removed in the major API cleanup.
import type { DiagramRFNode } from '../index';

describe('major-version editor API types', () => {
  it('uses implementation-neutral diagram names', () => {
    const node: DiagramNode = { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } };
    const edge: DiagramEdge = { id: 'a-b', source: 'a', target: 'b' };
    expect([node.id, edge.id]).toEqual(['a', 'a-b']);
  });

  it('does not accept the removed EditorShell container prop', () => {
    const props: EditorShellProps = {
      // @ts-expect-error Use workspaceContainer; container was removed.
      container: null,
    };
    expect(props).toHaveProperty('container');
  });

  it('keeps the old type import absent', () => {
    const legacy: DiagramRFNode | null = null;
    expect(legacy).toBeNull();
  });
});
