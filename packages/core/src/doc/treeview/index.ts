/**
 * ASCII treeview codec: detect / parse / render file-tree & outline art,
 * plus mapping helpers between the tree model and the template/layer data.
 *
 * The fence text is the source of truth end-to-end: the editor parses it
 * live for an interactive outline and re-renders it after each edit; the
 * doc pipeline derives `templateData.items` from it so the player renders
 * the same tree. Peer to the ASCII diagram codec.
 */

export { parseTree, parseTreeWithStats } from './parse.js';
export type { TreeLineStats } from './parse.js';
export { renderTree } from './render.js';
export type { RenderTreeOptions } from './render.js';
export {
  detectTree,
  isTreeFence,
  isEligibleTreeFenceLang,
  isExplicitTreeLang,
  TREE_FENCE_LANGS,
} from './detect.js';
export type { DetectTreeOptions } from './detect.js';
export {
  treeToTemplateData,
  treeFromTemplateData,
  treeFromMarkdownList,
  findFirstList,
} from './mapping.js';
export type { TreeItem } from './mapping.js';
export type { Tree, TreeNode, TreeDetection } from './types.js';
