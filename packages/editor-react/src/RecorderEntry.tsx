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

import { useCallback, useMemo } from 'react';
import { resolveThemeForDoc } from '@bendyline/squisq/doc';
import { RecorderPanel } from './recorder/RecorderPanel.js';
import type { RecorderNarrationOptions, RecorderSaveResult } from './recorder/RecorderModal.js';
import { insertMediaBlock, insertMediaBlocks } from './recorder/insertMediaBlock.js';
import { buildDualClipInsertion } from './recorder/dualClipInsertion.js';
import { useEditorContext } from './EditorContext';
import { usePreviewSettingsOptional } from './PreviewControls';
import { markdownFencedCodeLineMask } from './markdownCodeFence';

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
  const fencedLines = markdownFencedCodeLineMask(model.getValue());
  // Walk upward from the cursor to find the nearest heading line.
  for (let line = position.lineNumber; line >= 1; line--) {
    if (fencedLines[line - 1]) continue;
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

export interface RecorderEntryProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export function RecorderEntry({ open, onOpenChange, showTrigger = true }: RecorderEntryProps = {}) {
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
    colorScheme,
    doc,
    allowNarrate,
  } = useEditorContext();

  // Prefer the live preview theme (respects the theme dropdown + custom-theme
  // registry) when a PreviewSettingsProvider is in scope; hosts composing
  // RecorderEntry outside one fall back to plain doc-scoped resolution, which
  // lacks preview-controls overrides.
  const previewSettings = usePreviewSettingsOptional();
  const theme = previewSettings?.activeTheme ?? resolveThemeForDoc(doc);

  const narration = useMemo<RecorderNarrationOptions | null>(() => {
    if (!allowNarrate || !mediaProvider) return null;
    return {
      doc,
      theme,
      recording: {
        mediaProvider,
        container: workspaceContainer ?? null,
        markdownSource,
        setMarkdownSource,
        bumpMediaRevision,
      },
    };
  }, [
    allowNarrate,
    mediaProvider,
    doc,
    theme,
    workspaceContainer,
    markdownSource,
    setMarkdownSource,
    bumpMediaRevision,
  ]);

  const handleSave = useCallback(
    (result: RecorderSaveResult) => {
      bumpMediaRevision();

      if (result.mediaKind === 'audio') {
        // Every audio-only result gets compact playback controls. Narration
        // additionally annotates the nearest heading (drives the slideshow
        // audio-mapping pipeline); a camera/screen request that happened to
        // produce only audio remains an ordinary embedded clip.
        if (result.source === 'mic' && activeView === 'raw' && monacoEditor) {
          annotateMonacoHeading(monacoEditor, result.filename);
        }
        const audioTag = `<audio src="${result.relativePath}" controls></audio>`;
        if (activeView === 'wysiwyg' && tiptapEditor) {
          insertMediaBlock(tiptapEditor, {
            type: 'audio',
            attrs: { src: result.relativePath, controls: true },
          });
          return;
        }
        if (activeView === 'raw' && monacoEditor) {
          // Keep the player on a fresh line at the cursor.
          insertAtCursor(`\n\n${audioTag}\n`);
          return;
        }
        setMarkdownSource(markdownSource ? `${markdownSource}\n\n${audioTag}` : audioTag);
        return;
      }

      // Screen + camera — two files composed as scheduled clips: the screen
      // as a full-frame overlay, the camera as a picture-in-picture bubble,
      // both document-anchored so playback shows the composed replay. Screen
      // tag first (DOM order = z-order → the bubble sits on top).
      if (result.source === 'screen+camera' && result.camera) {
        const dual = buildDualClipInsertion(result);
        if (dual) {
          if (activeView === 'wysiwyg' && tiptapEditor) {
            insertMediaBlocks(tiptapEditor, [
              { type: 'video', attrs: dual.screenAttrs },
              { type: 'video', attrs: dual.cameraAttrs },
            ]);
            return;
          }
          const pair = `${dual.screenTag}\n\n${dual.cameraTag}`;
          if (activeView === 'raw' && monacoEditor) {
            insertAtCursor(`\n\n${pair}\n`);
            return;
          }
          setMarkdownSource(markdownSource ? `${markdownSource}\n\n${pair}` : pair);
          return;
        }
      }

      // Camera / screen / screen+mic — inline video player. We pin
      // width=480 so the editor preview doesn't blow up to natural
      // resolution on big monitors; the height is intrinsic, so the
      // aspect ratio is preserved regardless of source dimensions.
      const videoTag = `<video src="${result.relativePath}" controls width="480"></video>`;
      if (activeView === 'wysiwyg' && tiptapEditor) {
        insertMediaBlock(tiptapEditor, {
          type: 'video',
          attrs: { src: result.relativePath, controls: true, width: 480 },
        });
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
      colorScheme={colorScheme}
      narration={narration}
      onSave={handleSave}
      className="squisq-toolbar-button"
      open={open}
      onOpenChange={onOpenChange}
      showTrigger={showTrigger}
    />
  );
}
