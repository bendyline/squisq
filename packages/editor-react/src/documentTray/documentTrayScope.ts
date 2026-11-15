/**
 * Which block of a block-at-a-time layout carries the document tray.
 *
 * The tray holds the document's opening media run (blanks, at most one
 * heading, then media — see `collectDocumentTrayMedia`). Block and timeline
 * layouts show one heading-defined slice at a time, so that run can reach
 * only the first slice, or the second when the first is a preamble made only
 * of media (the run then continues through the first heading). Enabling the
 * tray for exactly those slices shows the same clips the document layout's
 * tray does, and leaves every later block's media annotations alone.
 */

import { createDocument } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { markdownToTiptap } from '../tiptapBridge';
import { isMediaOnlyPreamble } from './documentTrayMedia';

/**
 * Whether the active slice of a block layout holds tray media.
 *
 * @param activeBlockKey - Index of the active slice.
 * @param leadingMarkdown - The body Markdown before the active slice
 *   (frontmatter excluded). Only read for the second slice.
 */
export function blockShowsDocumentTray(
  activeBlockKey: number,
  leadingMarkdown: string,
  schema: Schema,
): boolean {
  if (activeBlockKey <= 0) return true;
  if (activeBlockKey > 1) return false;
  try {
    return isMediaOnlyPreamble(createDocument(markdownToTiptap(leadingMarkdown), schema));
  } catch {
    return false;
  }
}
