/**
 * Configuration a Scene host (diagram / drawing / layout widget) supplies
 * so the shared inline text editor knows how to read and write the text of
 * a given layer. The Scene owns the editing UI (overlay + positioning);
 * the host owns persistence (markdown heading vs. layout JSON blob).
 */

import type { TextStyle } from '@bendyline/squisq/schemas';
import type { SceneTextChannel } from './sceneTextChannel';

export type SceneTextLevel = 'inline' | 'block' | 'rich';

/**
 * The type the editor sets its text in. Colors aren't included: the editor
 * keeps its own surface and text color so whatever it shows stays readable.
 */
export type SceneTextTypography = Pick<
  TextStyle,
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontStyle'
  | 'lineHeight'
  | 'textAlign'
  | 'verticalAlign'
  | 'padding'
>;

export interface SceneTextEditConfig {
  /** Per-editor bridge to the formatting toolbar. */
  channel?: SceneTextChannel;
  /**
   * Map a hit layer id (what the pointer landed on) to the layer id whose
   * on-screen box the editor should cover, or `null` when that layer isn't
   * text-editable. e.g. a diagram card hit (`node-card-x`) maps to itself;
   * a non-text drawing shape maps to `null`.
   */
  resolveEditableId: (layerId: string) => string | null;
  /**
   * Typography for an edited layer that isn't itself text: a diagram card
   * edits the label drawn on it, so the editor should match that label's
   * size, weight and alignment. A text layer always uses its own style.
   */
  textStyle?: (editableId: string) => SceneTextTypography | undefined;
  /** Seed HTML for the editor (e.g. `content.html` or `markdownToTiptap(label)`). */
  getHtml: (editableId: string) => string;
  /** Persist the edited content. The host serializes per its storage model. */
  commit: (editableId: string, content: { html: string; text: string }) => void;
  /**
   * Toolbar capability gate: `inline` = marks only; `block` = marks + lists +
   * blockquote (no headings, for layout textboxes); `rich` = also headings.
   */
  level: SceneTextLevel;
}
