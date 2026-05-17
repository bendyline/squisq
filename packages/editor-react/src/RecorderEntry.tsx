/**
 * RecorderEntry — toolbar slot that wires `RecorderPanel` from
 * `@bendyline/squisq-recorder-react` into the editor.
 *
 * Reads `mediaProvider`, `workspaceContainer`, `activeView`,
 * `tiptapEditor`, and the markdown editing helpers from
 * `useEditorContext()`. On a successful save it:
 *   - inserts a markdown reference at the cursor — annotated
 *     `{[audio=…]}` on the current block for narration, a media link
 *     `![alt](path)` for camera / screen recordings;
 *   - bumps `mediaRevision` so any blob URLs the media bin cached for
 *     the previous file list are invalidated.
 *
 * The component returns `null` when no `mediaProvider` is wired —
 * recording without a place to write the captured bytes is a
 * misconfiguration, not a feature.
 */

import { useCallback } from 'react';
import { RecorderPanel, type RecorderSaveResult } from '@bendyline/squisq-recorder-react';
import { useEditorContext } from './EditorContext';

/**
 * Insert a narration annotation `{[audio=filename]}` onto the heading
 * line currently above the cursor in the Monaco editor. Pure-text
 * insertion at the line's end keeps the markdown valid and matches the
 * shape `resolveAudioMapping()` reads. Returns true if a heading line
 * was found and updated.
 */
function annotateMonacoHeading(
  editor: NonNullable<ReturnType<typeof useEditorContext>['monacoEditor']>,
  filename: string,
): boolean {
  const model = editor.getModel();
  if (!model) return false;
  const position = editor.getPosition();
  if (!position) return false;
  // Walk upward from the cursor to find the nearest heading line.
  for (let line = position.lineNumber; line >= 1; line--) {
    const text = model.getLineContent(line);
    if (!/^#{1,6}\s/.test(text)) continue;
    // Skip if the heading already has an audio annotation — don't
    // stomp the user's existing wiring. Add a separate annotation in
    // that case wouldn't help either (resolveAudioMapping reads only
    // the first audio= entry).
    if (/\{\[audio=/.test(text)) return true;
    const trimmed = text.replace(/\s+$/, '');
    const insertText = ` {[audio=${filename}]}`;
    const column = trimmed.length + 1;
    editor.executeEdits('recorder-annotation', [
      {
        range: {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column,
        },
        text: insertText,
      },
    ]);
    return true;
  }
  return false;
}

export function RecorderEntry() {
  const {
    mediaProvider,
    workspaceContainer,
    activeView,
    monacoEditor,
    tiptapEditor,
    insertAtCursor,
    bumpMediaRevision,
    markdownSource,
    setMarkdownSource,
  } = useEditorContext();

  const handleSave = useCallback(
    (result: RecorderSaveResult) => {
      bumpMediaRevision();

      const alt = result.filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

      if (result.source === 'mic') {
        // Narration — annotate the current block heading so
        // resolveAudioMapping() ties this MP3/WebM to that block.
        if (activeView === 'raw' && monacoEditor) {
          const annotated = annotateMonacoHeading(monacoEditor, result.filename);
          if (annotated) return;
        }
        // Fallbacks: append the annotation as its own block so the
        // recording at least lands in the source. The user can move it
        // to the right heading afterwards.
        const fallback = `<!-- recorded narration: ${result.relativePath} -->\n\n## {[audio=${result.filename}]}`;
        if (activeView === 'wysiwyg' && tiptapEditor) {
          tiptapEditor.chain().focus().insertContent(`<p>${fallback}</p>`).run();
        } else {
          setMarkdownSource(markdownSource ? `${markdownSource}\n\n${fallback}` : fallback);
        }
        return;
      }

      // Camera / screen — insert a media link at the cursor.
      const snippet = `![${alt}](${result.relativePath})`;
      if (activeView === 'wysiwyg' && tiptapEditor) {
        // No <video> Tiptap node in the default schema — fall back to a
        // plain link so the markdown round-trips cleanly.
        tiptapEditor
          .chain()
          .focus()
          .insertContent([
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: result.relativePath } }],
              text: alt,
            },
          ])
          .run();
        return;
      }
      if (activeView === 'raw' && monacoEditor) {
        insertAtCursor(snippet);
        return;
      }
      setMarkdownSource(markdownSource ? `${markdownSource}\n\n${snippet}` : snippet);
    },
    [
      activeView,
      monacoEditor,
      tiptapEditor,
      insertAtCursor,
      bumpMediaRevision,
      markdownSource,
      setMarkdownSource,
    ],
  );

  if (!mediaProvider) return null;

  return (
    <RecorderPanel
      mediaProvider={mediaProvider}
      container={workspaceContainer}
      onSave={handleSave}
      className="squisq-toolbar-button"
    />
  );
}
