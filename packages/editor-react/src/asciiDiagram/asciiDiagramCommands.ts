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
  type AsciiDiagram,
} from '@bendyline/squisq/doc';
import type { DiagramCommand } from '../diagram/DiagramCanvas';
import { findAsciiDiagramBlockPos, parseAsciiDiagramForNode } from './AsciiDiagramExtension';
import {
  addEdgeOp,
  addNodeOp,
  moveNodeOp,
  removeEdgeOp,
  removeNodeOp,
  renameNodeOp,
  resizeNodeOp,
} from './asciiDiagramOps';

/**
 * Replace only the TEXT inside the codeBlock at `pos` — attributes
 * (including `language`) stay untouched. No-op when the text is already
 * identical, so history stays clean.
 */
export function replaceAsciiFenceText(editor: Editor, pos: number, nextText: string): boolean {
  return editor
    .chain()
    .command(({ tr, state }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node || node.type.name !== 'codeBlock') return false;
      if (node.textContent === nextText) return false;
      tr.replaceWith(pos + 1, pos + node.nodeSize - 1, state.schema.text(nextText));
      return true;
    })
    .run();
}

/** Apply one pure op to a registered block's parsed diagram. */
function applyOp(
  editor: Editor,
  blockId: string,
  op: (diagram: AsciiDiagram) => AsciiDiagram,
): boolean {
  // Resolve the position at dispatch time — captured positions go stale
  // the moment anything above the block changes.
  const pos = findAsciiDiagramBlockPos(editor, blockId);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'codeBlock') return false;
  const diagram = parseAsciiDiagramForNode(node);
  if (!diagram) return false;

  const next = op(diagram);
  if (next === diagram) return false;
  const rendered = renderAsciiDiagram(next);

  // Verify before committing: the rendered art must re-parse to the same
  // node count, or we'd write art the canvas can't read back.
  const verification = parseAsciiDiagram(rendered);
  if (verification.nodes.length !== next.nodes.length) return false;

  return replaceAsciiFenceText(editor, pos, rendered);
}

/** Full pipeline for a canvas command against a registered fence block. */
export function applyAsciiDiagramCommand(
  editor: Editor,
  blockId: string,
  cmd: DiagramCommand,
): boolean {
  switch (cmd.kind) {
    case 'moveNode': {
      const { col, row } = canvasToAsciiCell(cmd.x, cmd.y);
      return applyOp(editor, blockId, (d) => moveNodeOp(d, cmd.nodeId, col, row));
    }
    case 'resizeNode': {
      const wCols = Math.max(3, Math.round(cmd.width / ASCII_CHAR_W));
      const hRows = Math.max(3, Math.round(cmd.height / ASCII_CHAR_H));
      return applyOp(editor, blockId, (d) => resizeNodeOp(d, cmd.nodeId, wCols, hRows));
    }
    case 'addConnection':
      return applyOp(editor, blockId, (d) => addEdgeOp(d, cmd.source, cmd.target, cmd.type));
    case 'removeConnection':
      return applyOp(editor, blockId, (d) => removeEdgeOp(d, cmd.source, cmd.target, cmd.type));
    case 'renameNode':
      return applyOp(editor, blockId, (d) => renameNodeOp(d, cmd.nodeId, cmd.newLabel));
    case 'addNode': {
      const { col, row } = canvasToAsciiCell(cmd.x, cmd.y);
      return applyOp(editor, blockId, (d) => addNodeOp(d, { col, row }).diagram);
    }
    case 'removeNode':
      return applyOp(editor, blockId, (d) => removeNodeOp(d, cmd.nodeId));
  }
  const _exhaustive: never = cmd;
  void _exhaustive;
  return false;
}
