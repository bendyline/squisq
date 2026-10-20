/**
 * A stable fingerprint of everything that decides a layout: the graph in
 * order and the resolved options. Equal signatures mean an identical layout,
 * so hosts can key a cache on it.
 */

import { resolveLayoutOptions } from './layout.js';
import type { LayoutGraph, LayoutOptions } from './types.js';

/** Bump when the algorithm changes its output for the same input. */
export const LAYOUT_ALGORITHM_VERSION = 1;

export function graphSignature(graph: LayoutGraph, options?: LayoutOptions): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x5bd1e995);
      h2 ^= h2 >>> 15;
    }
    // A separator no id can forge: lengths are fed explicitly.
    h1 = Math.imul(h1 ^ 0xff, 0x01000193);
    h2 = Math.imul(h2 ^ 0xff, 0x5bd1e995);
  };
  feed(`v${LAYOUT_ALGORITHM_VERSION}`);
  feed(JSON.stringify(resolveLayoutOptions(options)));
  feed(String(graph.nodes.length));
  for (const node of graph.nodes) {
    feed(`${node.id.length}:${node.id}`);
    feed(`${node.width},${node.height}`);
    feed(node.parent === undefined ? '-' : `${node.parent.length}:${node.parent}`);
  }
  feed(String(graph.edges.length));
  for (const edge of graph.edges) {
    feed(`${edge.id.length}:${edge.id}`);
    feed(`${edge.source.length}:${edge.source}`);
    feed(`${edge.target.length}:${edge.target}`);
    feed(String(edge.weight ?? 1));
  }
  const hex = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}
