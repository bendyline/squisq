/**
 * RecorderEntry — toolbar slot that wires `RecorderPanel` from
 * `@bendyline/squisq-recorder-react` into the editor.
 *
 * Reads `mediaProvider`, `workspaceContainer`, `activeView`,
 * `tiptapEditor`, and the markdown editing helpers from
 * `useEditorContext()`. On a successful save it:
 *   - inserts an HTML5 media element at the cursor — `<video>` for
 *     camera / screen recordings, `<audio>` for narration / mic
 *     recordings — which the markdown renderer turns into an inline
 *     `<InlineVideoPlayer>` / `<InlineAudioPlayer>` with native
 *     controls;
 *   - for narration, also annotates the nearest heading with
 *     `{[audio=filename]}` so `resolveAudioMapping()` continues to tie
 *     the recording to that block during slideshow playback;
 *   - bumps `mediaRevision` so any blob URLs the media bin cached for
 *     the previous file list are invalidated.
 *
 * The component returns `null` when no `mediaProvider` is wired —
 * recording without a place to write the captured bytes is a
 * misconfiguration, not a feature.
 */

import { useCallback } from 'react';
import { RecorderPanel } from './recorder/RecorderPanel.js';
import type { RecorderSaveResult } from './recorder/RecorderModal.js';
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

      if (result.source === 'mic') {
        // Narration — annotate the nearest heading (drives the
        // slideshow narration pipeline at `core/src/doc/audioMapping.ts`)
        // *and* insert an inline `<audio controls>` so the user can
        // audition the recording inside the editor. The two roles are
        // orthogonal: the annotation is metadata for playback timing,
        // the HTML tag is an in-editor preview control.
        if (activeView === 'raw' && monacoEditor) {
          annotateMonacoHeading(monacoEditor, result.filename);
        }
        const audioTag = `<audio src="${result.relativePath}" controls></audio>`;
        if (activeView === 'wysiwyg' && tiptapEditor) {
          tiptapEditor
            .chain()
            .focus()
            .insertContent({
              type: 'audio',
              attrs: { src: result.relativePath, controls: true },
            })
            .run();
          return;
        }
        if (activeView === 'raw' && monacoEditor) {
          // The annotation went onto the heading line; drop the player
          // on a fresh line at the cursor.
          insertAtCursor(`\n\n${audioTag}\n`);
          return;
        }
        setMarkdownSource(markdownSource ? `${markdownSource}\n\n${audioTag}` : audioTag);
        return;
      }

      // Camera / screen / screen+mic — inline video player. We pin
      // width=480 so the editor preview doesn't blow up to natural
      // resolution on big monitors; the height is intrinsic, so the
      // aspect ratio is preserved regardless of source dimensions.
      const videoTag = `<video src="${result.relativePath}" controls width="480"></video>`;
      if (activeView === 'wysiwyg' && tiptapEditor) {
        tiptapEditor
          .chain()
          .focus()
          .insertContent({
            type: 'video',
            attrs: { src: result.relativePath, controls: true, width: 480 },
          })
          .run();
        return;
      }
      if (activeView === 'raw' && monacoEditor) {
        insertAtCursor(videoTag);
        return;
      }
      setMarkdownSource(markdownSource ? `${markdownSource}\n\n${videoTag}` : videoTag);
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
