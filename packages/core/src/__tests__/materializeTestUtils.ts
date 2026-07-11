import type { Layer } from '../schemas/Doc.js';
import type { DocBlock } from '../schemas/BlockTemplates.js';
import {
  materializeBlockLayers,
  type MaterializeBlockLayersOptions,
} from '../doc/materializeBlockLayers.js';

/** Materialize isolated test fixtures without inheriting theme atmosphere. */
export function materializeLayers(
  block: DocBlock,
  options: MaterializeBlockLayersOptions = {},
): Layer[] {
  return materializeBlockLayers(block, {
    persistentLayers: false,
    ...options,
  }).layers;
}
