/**
 * Placeholder token definitions for the template designer — the single
 * source of truth shared by:
 *
 *   - `AddBin`              (renders the draggable/clickable buttons),
 *   - `TemplateDesigner`    (builds one `createTokenTool` per entry, and
 *                            looks an entry up by id on drop).
 *
 * Each token's `token` string is the literal substituted at render time
 * (e.g. `{title}`) and doubles as the preview shown on the button.
 */

import type { TokenKind } from '../scene';

export interface TokenDef {
  /** Stable id, used both as the tool id and the drag payload. */
  id: string;
  /** Short button label. */
  label: string;
  /** Tooltip describing what the placeholder substitutes. */
  desc: string;
  /** Placeholder string dropped into the layer and shown as the preview. */
  token: string;
  /** Which layer kind the token creates. */
  kind: TokenKind;
}

/** MIME type carried on the drag's `dataTransfer` for a placeholder token. */
export const TOKEN_DRAG_MIME = 'application/x-squisq-token';

export const TOKEN_DEFS: TokenDef[] = [
  {
    id: 'token-title',
    label: 'Title',
    desc: "Substitutes the block's heading text.",
    token: '{title}',
    kind: 'text',
  },
  {
    id: 'token-content',
    label: 'Content',
    desc: "Substitutes the block's body text.",
    token: '{content}',
    kind: 'text',
  },
  {
    id: 'token-children',
    label: 'Children',
    desc: 'Comma-joined list of child heading titles.',
    token: '{children}',
    kind: 'text',
  },
  {
    id: 'token-image',
    label: 'Image',
    desc: "The first image found in the block's body.",
    token: '{image:0}',
    kind: 'image',
  },
];
