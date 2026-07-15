/**
 * Write direction of the ASCII diagram loop: canvas command → fence rewrite.
 *
 * Every semantic edit is one functional transformation of the fence text
 * (`renderAscii(applyOp(parseAscii(text)))`) committed as a single
 * ProseMirror transaction (= a single undo step). Before committing, the
 * rendered art is re-parsed and verified — if the renderer ever produced
 * something the parser disagrees with, the command aborts instead of
 * corrupting the fence.
 */

import type { Editor } from '@tiptap/react';
import {
  canvasToAsciiCell,
  ASCII_CHAR_H,
  ASCII_CHAR_W,
  parseAsciiDiagram,
  renderAsciiDiagram,
  repairAsciiDiagram,
  type AsciiDiagram,
} from '@bendyline/squisq/doc';
import type { DiagramCommand } from '../diagram/DiagramCanvas';
import { findAsciiDiagramBlockPos, parseAsciiDiagramForNode } from './AsciiDiagramExtension';
import { findRepairableBlockPos } from './RepairableDiagramExtension';
import {
  addEdgeOp,
  addNodeOp,
  moveNodeOp,
  removeEdgeOp,
  removeNodeOp,
  renameNodeOp,
  resizeNodeOp,
  translateDiagramOp,
} from './asciiDiagramOps';

export interface ApplyAsciiDiagramCommandOptions {
  /**
   * Virtual grid offset currently shown by the canvas for legacy art. It is
   * folded into the source in the same transaction as the user's first edit.
   */
  diagramOffset?: { col: number; row: number };
}

/**
 * Replace the TEXT inside the codeBlock at `pos` and, when `ensureLanguage`
 * is given, promote its `language` attribute in the SAME transaction (one
 * undo step). Promoting the language to the explicit `diagram`/`tree` tag is
 * how a semantic edit makes the block's identity "sticky" — the language
 * class survives markdown ↔ Tiptap round-trips, so a once-edited diagram/tree
 * is re-recognized even after it's flattened. No-op (returns false) only when
 * BOTH the text is already identical AND the language already matches, so
 * history stays clean on a true no-op.
 *
 * This is the single write boundary for the diagram, tree AND timeline
 * families, so it is also where the editor's read-only authority is enforced.
 * A mounted canvas/outline outlives the render that created its controls, so
 * a host flipping the editor read-only (saving, locked, permission change)
 * must not leave a stale drag/click able to rewrite the fence.
 */
export function replaceAsciiFenceText(
  editor: Editor,
  pos: number,
  nextText: string,
  ensureLanguage?: string,
): boolean {
  if (!editor.isEditable) return false;
  return editor
    .chain()
    .command(({ tr, state }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node || node.type.name !== 'codeBlock') return false;
      const textChanged = node.textContent !== nextText;
      const currentLang = (node.attrs as { language?: string | null }).language ?? null;
      const langChanged = ensureLanguage !== undefined && currentLang !== ensureLanguage;
      if (!textChanged && !langChanged) return false;
      if (langChanged) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: ensureLanguage });
      }
      if (textChanged) {
        tr.replaceWith(pos + 1, pos + node.nodeSize - 1, state.schema.text(nextText));
      }
      return true;
    })
    .run();
}

/**
 * Reconstruct a broken box-art fence into clean, `diagram`-tagged art in a
 * single transaction (one undo step). The AsciiDiagramExtension then claims
 * the tagged fence and mounts the interactive canvas. Returns false when the
 * block is gone or nothing recoverable (the button simply no-ops).
 */
export function applyRepairCommand(editor: Editor, blockId: string): boolean {
  // The banner button may outlive the render that mounted it.
  if (!editor.isEditable) return false;
  const pos = findRepairableBlockPos(editor, blockId);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'codeBlock') return false;
  const repaired = repairAsciiDiagram(node.textContent);
  if (!repaired) return false;
  return replaceAsciiFenceText(editor, pos, repaired.art, 'diagram');
}

/** Apply one pure op to a registered block's parsed diagram. */
function applyOp(
  editor: Editor,
  blockId: string,
  op: (diagram: AsciiDiagram) => AsciiDiagram,
  diagramOffset?: { col: number; row: number },
): boolean {
  // Resolve the position at dispatch time — captured positions go stale
  // the moment anything above the block changes.
  const pos = findAsciiDiagramBlockPos(editor, blockId);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'codeBlock') return false;
  const sourceDiagram = parseAsciiDiagramForNode(node);
  if (!sourceDiagram) return false;
  const diagram = diagramOffset
    ? translateDiagramOp(sourceDiagram, diagramOffset.col, diagramOffset.row)
    : sourceDiagram;

  const next = op(diagram);
  if (next === diagram && diagram === sourceDiagram) return false;
  const rendered = renderAsciiDiagram(next);

  // Verify before committing: the rendered art must re-parse to the same
  // node count, or we'd write art the canvas can't read back.
  const verification = parseAsciiDiagram(rendered);
  if (verification.nodes.length !== next.nodes.length) return false;

  // Promote the fence language to the explicit `diagram` tag so this block's
  // identity survives a later flatten → markdown → re-import round-trip.
  return replaceAsciiFenceText(editor, pos, rendered, 'diagram');
}

/** Full pipeline for a canvas command against a registered fence block. */
export function applyAsciiDiagramCommand(
  editor: Editor,
  blockId: string,
  cmd: DiagramCommand,
  options: ApplyAsciiDiagramCommandOptions = {},
): boolean {
  // Commands may outlive the render that created their controls. Enforce the
  // editor's current authority at dispatch time, not only in widget props.
  if (!editor.isEditable) return false;

  const apply = (op: (diagram: AsciiDiagram) => AsciiDiagram) =>
    applyOp(editor, blockId, op, options.diagramOffset);
  switch (cmd.kind) {
    case 'moveNode': {
      const { col, row } = canvasToAsciiCell(cmd.x, cmd.y);
      return apply((d) => moveNodeOp(d, cmd.nodeId, col, row));
    }
    case 'resizeNode': {
      const wCols = Math.max(3, Math.round(cmd.width / ASCII_CHAR_W));
      const hRows = Math.max(3, Math.round(cmd.height / ASCII_CHAR_H));
      return apply((d) => {
        // A north/west resize changes position and size. Apply both to the
        // same parsed model and render once so collision/layout normalization
        // cannot run between the two halves of one pointer gesture.
        let next = d;
        if (cmd.x !== undefined && cmd.y !== undefined) {
          const { col, row } = canvasToAsciiCell(cmd.x, cmd.y);
          next = moveNodeOp(next, cmd.nodeId, col, row);
        }
        return resizeNodeOp(next, cmd.nodeId, wCols, hRows);
      });
    }
    case 'addConnection':
      return apply((d) => addEdgeOp(d, cmd.source, cmd.target, cmd.type));
    case 'removeConnection':
      return apply((d) => removeEdgeOp(d, cmd.source, cmd.target, cmd.type));
    case 'renameNode':
      return apply((d) => renameNodeOp(d, cmd.nodeId, cmd.newLabel));
    case 'addNode': {
      const { col, row } = canvasToAsciiCell(cmd.x, cmd.y);
      return apply((d) => addNodeOp(d, { col, row }).diagram);
    }
    case 'removeNode':
      return apply((d) => removeNodeOp(d, cmd.nodeId));
  }
  const _exhaustive: never = cmd;
  void _exhaustive;
  return false;
}
