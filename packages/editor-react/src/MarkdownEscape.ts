/**
 * MarkdownEscape — Tiptap Mark Extension
 *
 * A backslash escape (`\$`, `\#`, `\[`) is source syntax: the reader of the
 * rendered document sees only the character. The Write view used to show the
 * backslash too, so a quote converted from Word read `\$3.50` and a hashtag
 * line read `\#RiseAndCrumb`, and anyone who copied the text carried the
 * backslashes along.
 *
 * Dropping the backslash on the way in is not safe on its own. `\$3.50 and
 * \$4.00` escapes the dollars precisely because `$3.50 and $4.00` parses as
 * inline math, and the Write view has no math node to keep the two apart. So
 * the bridge marks each escaped character with this invisible mark instead,
 * and writes the backslash back in front of it (see `tiptapBridge.ts`). The
 * person sees `$3.50`; the file keeps `\$3.50`, byte for byte.
 *
 * `inclusive: false` keeps text typed right after an escaped character plain.
 */

import { Mark, mergeAttributes } from '@tiptap/core';
import { MARKDOWN_ESCAPE_ATTR } from './tiptapBridge';

export const MarkdownEscape = Mark.create({
  name: 'markdownEscape',
  inclusive: false,

  parseHTML() {
    return [{ tag: `span[${MARKDOWN_ESCAPE_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { [MARKDOWN_ESCAPE_ATTR]: '' }), 0];
  },
});
