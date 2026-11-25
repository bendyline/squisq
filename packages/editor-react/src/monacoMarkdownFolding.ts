/**
 * Folding for accessory blocks (slide summaries) in the Source view.
 *
 * Each accessory block — a heading tagged `{[summary]}` and everything under
 * it, to the next heading at its level or shallower — folds to its heading
 * line, and opens folded the first time a document is shown: the heading says
 * what is there, the body stays out of the way. Monaco folds a range to a
 * line of the document and cannot label it, so in Source each block folds on
 * its own rather than a section's run folding into one row as in Write.
 *
 * Documents without accessory blocks get no ranges from here, so Monaco's own
 * folding (indentation, `<!-- #region -->`) is unchanged for them; a provider
 * that answers replaces that folding for the document it answers for.
 */

import type * as Monaco from 'monaco-editor';
import { isAccessoryBlockType } from '@bendyline/squisq/doc';
import { readHeadingLineTemplate } from './headingTemplateLine';
import { getCachedMarkdownFencedCodeLineMask } from './rawEditorIsolation';

const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]|$)/;

/** One accessory block's lines: its heading, and its last line with text. */
export interface AccessoryFoldingRange {
  start: number;
  end: number;
}

/**
 * The accessory blocks among `lines` (1-based line numbers), skipping lines
 * inside code fences. Each runs from its heading to the line before the next
 * heading at its level or shallower, trailing blank lines left open.
 */
export function accessoryFoldingRanges(
  lines: readonly string[],
  fenced: (lineNumber: number) => boolean = () => false,
): AccessoryFoldingRange[] {
  const headings: Array<{ line: number; level: number; accessory: boolean }> = [];
  lines.forEach((text, index) => {
    const lineNumber = index + 1;
    if (fenced(lineNumber)) return;
    const match = ATX_HEADING_RE.exec(text);
    if (!match) return;
    headings.push({
      line: lineNumber,
      level: match[1]!.length,
      accessory: isAccessoryBlockType(readHeadingLineTemplate(text)),
    });
  });
  const ranges: AccessoryFoldingRange[] = [];
  headings.forEach((heading, index) => {
    if (!heading.accessory) return;
    const next = headings.slice(index + 1).find((other) => other.level <= heading.level);
    let end = (next?.line ?? lines.length + 1) - 1;
    while (end > heading.line && !lines[end - 1]!.trim()) end -= 1;
    if (end > heading.line) ranges.push({ start: heading.line, end });
  });
  return ranges;
}

/** Models whose first folding was computed: later ranges are not folded for the reader. */
const shown = new WeakSet<Monaco.editor.ITextModel>();
const registered = new WeakSet<object>();

/**
 * Register the provider with this Monaco instance (once). Pair it with the
 * editor option `foldingImportsByDefault: true`: the first ranges computed for
 * a model are marked as imports, which Monaco folds when it opens the model;
 * a block typed later is not folded under the caret.
 */
export function registerMarkdownAccessoryFolding(monaco: typeof Monaco): void {
  if (registered.has(monaco.languages)) return;
  registered.add(monaco.languages);
  monaco.languages.registerFoldingRangeProvider('markdown', {
    provideFoldingRanges(model) {
      const fences = getCachedMarkdownFencedCodeLineMask(model);
      const ranges = accessoryFoldingRanges(
        model.getLinesContent(),
        (lineNumber) => fences[lineNumber - 1] ?? false,
      );
      // Only what the document opened with folds by itself; a summary typed
      // later stays open under the caret.
      const first = !shown.has(model);
      shown.add(model);
      if (!ranges.length) return null;
      return ranges.map((range) => ({
        start: range.start,
        end: range.end,
        ...(first ? { kind: monaco.languages.FoldingRangeKind.Imports } : {}),
      }));
    },
  });
}

/**
 * Fold the accessory blocks again, as when the document opened — after the
 * whole text was replaced from outside. Toggling folding makes Monaco treat
 * the model as new.
 */
export function refoldAccessoryBlocks(editor: Monaco.editor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  if (!model) return;
  shown.delete(model);
  editor.updateOptions({ folding: false });
  editor.updateOptions({ folding: true });
}
