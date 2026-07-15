/**
 * ITEM C regression: the pass-2 "boundary-churn survivor" adoption must
 * distinguish "same fence, churned boundaries" from "a DIFFERENT fence now
 * sits where the deleted one used to be".
 *
 * Both look identical by position: the old start maps to a position that
 * still holds a codeBlock, with `mapResult(...).deleted === true`. Adopting on
 * position alone hands the dead entry's session id — and its widget React root
 * (pan/zoom, height, `sourceVisible`) — to the wrong block, AND routes that
 * block through the LENIENT `parse*ForNode` hysteresis gate instead of full
 * detection, so a fence that never qualified gets claimed as interactive.
 *
 * Verified by execution before the fix (see CASE 2 below): a registered
 * two-box diagram followed by a single-box fence (parses to 1 box → passes the
 * lenient gate, fails full detection's ≥2-box threshold). Deleting the first
 * fence promoted the single-box fence into the registry under `ascii-1`.
 *
 * The churn case that pass 2 exists for (language promotion via
 * `setNodeMarkup`) must keep working — covered here and in each family's own
 * "keeps the block id stable across the language-promotion rewrite" test.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { markdownToTiptap } from '../../tiptapBridge';
import { AsciiDiagramExtension, ASCII_DIAGRAM_KEY } from '../../asciiDiagram/AsciiDiagramExtension';
import { applyAsciiDiagramCommand } from '../../asciiDiagram/asciiDiagramCommands';
import { TreeViewExtension, TREEVIEW_KEY } from '../../treeview/TreeViewExtension';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class RO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  }
});

const TWO_BOX = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    │',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

const TWO_BOX_B = [
  '+-------+     +-------+',
  '| Left  | --> | Right |',
  '+-------+     +-------+',
].join('\n');

/** Parses to ONE box: passes the lenient gate, fails full detection (needs ≥2). */
const ONE_BOX = ['┌────────┐', '│ Solo   │', '└────────┘'].join('\n');

const TREE = ['src/', '├── a.ts', '└── sub/', '    └── b.ts'].join('\n');
/** A single bare line: no connector branches, so full tree detection declines. */
const NOT_A_TREE = 'just one line of prose';

let editors: Editor[] = [];

function makeEditor(md: string, extensions = [AsciiDiagramExtension]): Editor {
  const editor = new Editor({
    extensions: [StarterKit.configure({ heading: false }), ...extensions],
    content: markdownToTiptap(md),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
});

const diagramEntries = (e: Editor) => ASCII_DIAGRAM_KEY.getState(e.state)?.entries ?? [];
const treeEntries = (e: Editor) => TREEVIEW_KEY.getState(e.state)?.entries ?? [];

function deleteNodeAt(editor: Editor, pos: number): void {
  const node = editor.state.doc.nodeAt(pos);
  expect(node).not.toBeNull();
  editor.view.dispatch(editor.state.tr.delete(pos, pos + node!.nodeSize));
}

describe('fence registry identity on deletion (ITEM C)', () => {
  it('does not promote an UNQUALIFIED neighbour when the fence before it is deleted', () => {
    const editor = makeEditor('```\n' + TWO_BOX + '\n```\n\n```\n' + ONE_BOX + '\n```\n');

    // Only the two-box fence qualifies; the one-box fence is a plain code block.
    const before = diagramEntries(editor);
    expect(before).toHaveLength(1);
    expect(before[0].pos).toBe(0);

    deleteNodeAt(editor, before[0].pos);

    // The one-box fence now sits at position 0 — where the deleted diagram was.
    // It never passed detection, so it must NOT be claimed.
    expect(editor.state.doc.nodeAt(0)?.textContent).toBe(ONE_BOX);
    expect(diagramEntries(editor)).toHaveLength(0);
  });

  it('does not transfer the deleted fence session id to a surviving neighbour', () => {
    const editor = makeEditor('```\n' + TWO_BOX + '\n```\n\n```\n' + TWO_BOX_B + '\n```\n');
    const before = diagramEntries(editor);
    expect(before).toHaveLength(2);
    const [deleted, survivor] = before;

    deleteNodeAt(editor, deleted.pos);

    const after = diagramEntries(editor);
    expect(after).toHaveLength(1);
    // The survivor keeps its OWN id — it must never inherit the dead entry's.
    expect(after[0].id).toBe(survivor.id);
    expect(after[0].id).not.toBe(deleted.id);
    expect(editor.state.doc.nodeAt(after[0].pos)?.textContent).toBe(TWO_BOX_B);
  });

  it('does not hand a deleted diagram fence id to a following NON-diagram code block', () => {
    const editor = makeEditor('```\n' + TWO_BOX + '\n```\n\n```\nplain code\nno boxes\n```\n');
    const [entry] = diagramEntries(editor);
    expect(entry.pos).toBe(0);

    deleteNodeAt(editor, entry.pos);

    expect(diagramEntries(editor)).toHaveLength(0);
  });

  it('applies to the tree family too: an unqualified neighbour is not adopted', () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n\n```\n' + NOT_A_TREE + '\n```\n', [
      AsciiDiagramExtension,
      TreeViewExtension,
    ]);
    const before = treeEntries(editor);
    expect(before).toHaveLength(1);
    expect(before[0].pos).toBe(0);

    deleteNodeAt(editor, before[0].pos);

    expect(editor.state.doc.nodeAt(0)?.textContent).toBe(NOT_A_TREE);
    expect(treeEntries(editor)).toHaveLength(0);
  });

  it('STILL adopts across genuine boundary churn (language promotion)', () => {
    // The reason pass 2 exists: `setNodeMarkup` rewrites the codeBlock's
    // opening token, so the old start maps as `deleted` even though the same
    // fence is still there. The id — and the widget's React root — must survive.
    const editor = makeEditor('```\n' + TWO_BOX + '\n```\n');
    const [before] = diagramEntries(editor);
    expect(before.pos).toBe(0);

    // A canvas edit renders the art AND promotes the language to `diagram`
    // in one transaction.
    expect(
      applyAsciiDiagramCommand(editor, before.id, {
        kind: 'renameNode',
        nodeId: 'alpha',
        newLabel: 'Gamma',
      }),
    ).toBe(true);

    const after = diagramEntries(editor);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(editor.state.doc.nodeAt(after[0].pos)?.attrs.language).toBe('diagram');
  });
});
