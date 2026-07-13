/**
 * ASCII diagram codec: detect / parse / render box-and-line art, plus
 * mapping helpers between the grid model and the diagram canvas model.
 *
 * The fence text is the source of truth end-to-end: the editor parses it
 * live for an interactive canvas and re-renders it after each semantic
 * edit; the doc pipeline derives `templateData.nodes`/`edges` from it so
 * preview/player/exports show the same diagram.
 */

export { parseAsciiDiagram, parseAsciiDiagramWithStats } from './parse.js';
export type { AsciiParseStats } from './parse.js';
export { renderAsciiDiagram } from './render.js';
export type { RenderAsciiDiagramOptions } from './render.js';
export {
  ASCII_DIAGRAM_FENCE_LANGS,
  detectAsciiDiagram,
  isAsciiDiagramFence,
  isEligibleAsciiFenceLang,
  isExplicitDiagramLang,
} from './detect.js';
export type { DetectDiagramOptions } from './detect.js';
export { repairAsciiDiagram, isRepairableDiagram } from './repair.js';
export type { RepairResult } from './repair.js';
export {
  asciiCellToCanvas,
  asciiDiagramFromBlocks,
  asciiDiagramFromTemplateData,
  asciiDiagramToTemplateData,
  canvasToAsciiCell,
} from './mapping.js';
export { ASCII_CHAR_H, ASCII_CHAR_W } from './types.js';
export type {
  AsciiDiagram,
  AsciiDiagramDetection,
  AsciiDiagramEdge,
  AsciiDiagramNode,
} from './types.js';
