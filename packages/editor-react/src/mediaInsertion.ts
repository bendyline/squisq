/**
 * Putting a stored file into the document, in whichever view is active.
 *
 * An image becomes an image; video and audio become playable `<video>` /
 * `<audio>` players (the representation the recorder writes, which every
 * renderer swaps for an inline player); a data file (csv/tsv/xlsx/parquet)
 * becomes a sidecar reference block the Write view shows as a live grid; and
 * anything else becomes a link to the file. The Insert menu's Image/Media and
 * File items, file drops and Files-panel uploads all come through here, so
 * they can never disagree about what a given file turns into.
 */
import type { Editor, JSONContent } from '@tiptap/core';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { dataSidecarPrefix } from '@bendyline/squisq/doc';
import { needsQuoting, quoteAttrValue } from '@bendyline/squisq/markdown';
import type { EditorView } from './EditorContext';
import {
  buildSquisqMediaReference,
  fileReference,
  squisqMediaNode,
  type SquisqMediaDragPayload,
} from './mediaDragMime';
import { escapeLinkLabel, formatLinkDestination } from './markdownDestination';
import {
  classifyFile,
  processDataFiles,
  processMediaFiles,
  resolveDocBasename,
} from './utils/dropUtils';

export interface MediaInsertionTarget {
  activeView: EditorView;
  tiptapEditor: Editor | null;
  monacoEditor: MonacoEditorNs.IStandaloneCodeEditor | null;
  /** Used when no editing surface is live (the Use tab): append to the source. */
  appendMarkdown: (snippet: string) => void;
}

/** What surrounds the insertion point in the markdown source. */
export interface SourceLineContext {
  /** Text on the first selected line before the selection. */
  before: string;
  /** Text on the last selected line after the selection. */
  after: string;
  /** The line above the selection, or null at the top of the document. */
  previousLine: string | null;
  /** The line below the selection, or null at the end of the document. */
  nextLine: string | null;
}

/**
 * Pad a block-level snippet so it lands as its own paragraph. A `<video>` or
 * `<audio>` tag typed directly against prose would be absorbed into that
 * paragraph as inline HTML, and a `##` heading only is one at the start of a
 * line — so it needs a blank line on each side that touches text.
 */
export function asOwnParagraph(snippet: string, context: SourceLineContext): string {
  const lead = context.before.trim() ? '\n\n' : context.previousLine?.trim() ? '\n' : '';
  const trail = context.after.trim() ? '\n\n' : context.nextLine?.trim() ? '\n' : '';
  return lead + snippet + trail;
}

/**
 * Insert block content at the top level: in place of the caret's paragraph
 * when that paragraph is empty (the line the author just made for it),
 * otherwise after the caret's top-level block — never inside a list item,
 * whose serializer would drop a nested block.
 */
function insertTopLevel(editor: Editor, content: JSONContent[]): void {
  const { $from } = editor.state.selection;
  if ($from.depth < 1) {
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, content).run();
    return;
  }
  const block = $from.node(1);
  const range =
    block.type.name === 'paragraph' && block.content.size === 0
      ? { from: $from.before(1), to: $from.after(1) }
      : $from.after(1);
  editor.chain().focus().insertContentAt(range, content).run();
}

/** Write `markdown` over the Source view's selection; false when there is none. */
function writeToSource(
  monacoEditor: MonacoEditorNs.IStandaloneCodeEditor,
  markdown: string,
  block: boolean,
): boolean {
  const selection = monacoEditor.getSelection();
  const model = monacoEditor.getModel();
  if (!selection || !model) return false;
  const text = block
    ? asOwnParagraph(markdown, {
        before: model.getLineContent(selection.startLineNumber).slice(0, selection.startColumn - 1),
        after: model.getLineContent(selection.endLineNumber).slice(selection.endColumn - 1),
        previousLine:
          selection.startLineNumber > 1
            ? model.getLineContent(selection.startLineNumber - 1)
            : null,
        nextLine:
          selection.endLineNumber < model.getLineCount()
            ? model.getLineContent(selection.endLineNumber + 1)
            : null,
      })
    : markdown;
  monacoEditor.executeEdits('insert-media', [{ range: selection, text, forceMoveMarkers: true }]);
  monacoEditor.focus();
  return true;
}

/** Insert a reference to a stored image, video, audio or other file. */
export function insertMediaReference(
  target: MediaInsertionTarget,
  reference: SquisqMediaDragPayload,
): void {
  const { activeView, tiptapEditor, monacoEditor } = target;
  const node = squisqMediaNode(reference);

  if (activeView === 'wysiwyg' && tiptapEditor) {
    if (node?.type === 'image') {
      tiptapEditor.chain().focus().setImage(node.attrs).run();
    } else if (node) {
      // Players are block atoms.
      insertTopLevel(tiptapEditor, [node]);
    } else {
      tiptapEditor
        .chain()
        .focus()
        .insertContent([
          {
            type: 'text',
            marks: [{ type: 'link', attrs: { href: reference.name } }],
            text: reference.alt || reference.name,
          },
        ])
        .run();
    }
    return;
  }

  const markdown = buildSquisqMediaReference(reference);
  const isPlayer = node?.type === 'video' || node?.type === 'audio';
  if (activeView === 'raw' && monacoEditor && writeToSource(monacoEditor, markdown, isPlayer)) {
    return;
  }
  target.appendMarkdown(markdown);
}

/**
 * Insert a data-sidecar reference block: an annotated heading
 * (`## <title> {[dataTable src=…]}`) plus a body link to the file, which is
 * both what the Write view's data card claims and what a plain markdown
 * renderer degrades to.
 */
export function insertDataReference(
  target: MediaInsertionTarget,
  relativePath: string,
  fileName: string,
): void {
  const { activeView, tiptapEditor, monacoEditor } = target;
  const title = fileName.replace(/\.[^.]+$/, '');
  const srcValue = needsQuoting(relativePath) ? quoteAttrValue(relativePath) : relativePath;
  const params = `src=${srcValue}`;

  if (activeView === 'wysiwyg' && tiptapEditor) {
    insertTopLevel(tiptapEditor, [
      {
        type: 'heading',
        attrs: { level: 2, dataTemplate: 'dataTable', dataTemplateParams: params },
        content: [{ type: 'text', text: title }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            marks: [{ type: 'link', attrs: { href: relativePath } }],
            text: fileName,
          },
        ],
      },
    ]);
    return;
  }

  const markdown =
    `## ${title} {[dataTable ${params}]}\n\n` +
    `[${escapeLinkLabel(fileName)}](${formatLinkDestination(relativePath)})`;
  if (activeView === 'raw' && monacoEditor && writeToSource(monacoEditor, markdown, true)) return;
  target.appendMarkdown(markdown);
}

export interface FileStorage {
  mediaProvider: MediaProvider;
  /** The document's container; its path names the `<basename>_files/data/`
   *  sidecar folder. Without one the folder is `document_files/data/`. */
  workspaceContainer?: ContentContainer | null;
}

/**
 * Store a file the author picked and reference it in the document: a data
 * file goes into the data sidecar folder as a reference block, anything else
 * is stored beside the document and inserted by {@link insertMediaReference}
 * (image, player, or a link). Resolves to the stored path, or null when the
 * file could not be read or saved (already reported on the console).
 */
export async function addFileToDocument(
  file: File,
  target: MediaInsertionTarget,
  storage: FileStorage,
): Promise<string | null> {
  if (classifyFile(file) === 'data') {
    const prefix = dataSidecarPrefix(await resolveDocBasename(storage.workspaceContainer));
    const [path] = await processDataFiles([file], storage.mediaProvider, prefix);
    if (path) insertDataReference(target, path, file.name);
    return path ?? null;
  }
  const [path] = await processMediaFiles([file], storage.mediaProvider);
  if (path) insertMediaReference(target, fileReference(path, file.name, file.type));
  return path ?? null;
}
