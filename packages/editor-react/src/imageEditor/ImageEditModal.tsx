import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DARK_SURFACE,
  LIGHT_SURFACE,
  type ImageEditDoc,
  type MediaProvider,
} from '@bendyline/squisq/schemas';
import {
  MemoryContentContainer,
  scopeContainer,
  type ContentContainer,
} from '@bendyline/squisq/storage';
import { ImageEditor, type ImageEditorHandle } from '../ImageEditor';
import { useModalDialog } from '../modal/useModalDialog';
import {
  imageEditSignature,
  imageSaveFormatForPath,
  needsWriteBack,
  readWriteBackSignature,
  writeWriteBackSignature,
} from './writeBack';

interface ImageEditModalProps {
  relativePath: string;
  /**
   * Host's `ContentContainer`. When non-null the editor's per-image
   * sidecar is scoped underneath it as `.imageEdits/<sanitized>/` so
   * version snapshots travel with the doc. When null (host wired only a
   * `mediaProvider`) the modal creates a fresh in-memory container for
   * the edit session — export still writes the result back through
   * `mediaProvider`.
   */
  container: ContentContainer | null;
  mediaProvider: MediaProvider;
  onClose: () => void;
  onSaved: () => void;
  allowVersioning: boolean;
  versioningAutoSaveIdleMs?: number;
  /** EditorShell's `colorScheme` prop — 'light' or 'dark'. Threaded through
   *  so the image editor chrome matches the host shell. */
  shellTheme?: 'light' | 'dark';
}

/**
 * Modal overlay that mounts a full `<ImageEditor>` against a sidecar
 * container scoped under `.imageEdits/<sanitized-path>/` of the document's
 * `ContentContainer`. Opens when a user clicks the "Edit" affordance on an
 * image in the WYSIWYG view; on Export, rewrites the original image bytes
 * via `mediaProvider.addMedia(relativePath, blob, mime)` and bumps
 * `mediaRevision` so live `<img>` nodes pick up the new content.
 *
 * Closing (×, Escape, backdrop) saves too: the layers persist to the
 * sidecar as the user works, so a close that left the picture behind them
 * would show edits on reopen that the document never got. When the
 * picture already matches the layers, closing just closes.
 */
export function ImageEditModal({
  relativePath,
  container,
  mediaProvider,
  onClose,
  onSaved,
  allowVersioning,
  versioningAutoSaveIdleMs,
  shellTheme,
}: ImageEditModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ImageEditorHandle>(null);
  const saveFormat = imageSaveFormatForPath(relativePath);
  // Each unique image path gets its own sidecar so multiple images in the
  // same doc can be edited independently without colliding state. When the
  // host didn't supply a `container`, fall back to a fresh in-memory one
  // — the edit session is transient anyway and the final raster is what
  // gets written back through `mediaProvider`.
  const sidecar = useMemo(() => {
    const sanitized = relativePath.replace(/[^a-zA-Z0-9._-]+/g, '_');
    let hash = 2166136261;
    for (let i = 0; i < relativePath.length; i++) {
      hash ^= relativePath.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const scopedName = `${sanitized}-${(hash >>> 0).toString(36)}`;
    const parent: ContentContainer = container ?? new MemoryContentContainer();
    return scopeContainer(parent, `.imageEdits/${scopedName}`);
  }, [container, relativePath]);

  const [initialSrc, setInitialSrc] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setInitialSrc(null);
    setResolveError(null);
    mediaProvider.resolveUrl(relativePath).then(
      (url) => {
        if (!cancelled) setInitialSrc(url);
      },
      (err: unknown) => {
        if (!cancelled) {
          setResolveError(err instanceof Error ? err.message : String(err));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mediaProvider, relativePath]);

  // Signature of the layer state the picture was last written from: the
  // sidecar's record until this session writes back, then what it wrote.
  const recordedSignature = useMemo(() => readWriteBackSignature(sidecar), [sidecar]);
  const writtenSignatureRef = useRef<{ sidecar: ContentContainer; signature: string } | null>(null);

  const handleExport = useCallback(
    async (blob: Blob, format: 'png' | 'jpeg' | 'webp', doc: ImageEditDoc) => {
      const mime = `image/${format}`;
      try {
        await mediaProvider.addMedia(relativePath, blob, mime);
      } catch (err: unknown) {
        console.error('Failed to write image back:', err instanceof Error ? err.message : err);
        // Rethrow so the editor shows the failure and stays open.
        throw err;
      }
      const signature = imageEditSignature(doc);
      writtenSignatureRef.current = { sidecar, signature };
      try {
        await writeWriteBackSignature(sidecar, signature);
      } catch (err: unknown) {
        // The picture is saved; a lost record costs at most one redundant
        // save on a later close.
        console.warn(
          '[squisq-editor] image write-back record failed:',
          err instanceof Error ? err.message : err,
        );
      }
      onSaved();
    },
    [mediaProvider, relativePath, sidecar, onSaved],
  );

  // 'saving' while a close-triggered save runs; 'failed' after it failed,
  // when the next close discards instead of retrying forever.
  const [closeState, setCloseState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const closeStateRef = useRef(closeState);
  closeStateRef.current = closeState;

  const requestClose = useCallback(async () => {
    if (closeStateRef.current === 'saving') return;
    const editor = editorRef.current;
    const doc = editor?.getDoc() ?? null;
    if (closeStateRef.current === 'failed' || !editor || !doc) {
      onClose();
      return;
    }
    const written =
      writtenSignatureRef.current?.sidecar === sidecar
        ? writtenSignatureRef.current.signature
        : await recordedSignature;
    if (!needsWriteBack(doc, written)) {
      onClose();
      return;
    }
    closeStateRef.current = 'saving';
    setCloseState('saving');
    // On success the export path calls onSaved(), which closes the modal.
    const saved = await editor.save();
    if (!saved) {
      closeStateRef.current = 'failed';
      setCloseState('failed');
    }
  }, [onClose, recordedSignature, sidecar]);

  const handleCloseRequest = useCallback(() => {
    void requestClose();
  }, [requestClose]);
  useModalDialog({ rootRef: modalRef, dialogRef: surfaceRef, onClose: handleCloseRequest });

  return (
    <div
      ref={modalRef}
      className="squisq-image-edit-modal"
      data-testid="image-edit-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${relativePath}`}
      onClick={(e) => {
        // Click on the dim backdrop (but not on the surface) → close.
        if (e.target === e.currentTarget) handleCloseRequest();
      }}
    >
      <div ref={surfaceRef} className="squisq-image-edit-modal__surface">
        <header className="squisq-image-edit-modal__header">
          <span className="squisq-image-edit-modal__title">Edit image</span>
          <span className="squisq-image-edit-modal__path">{relativePath}</span>
          {closeState === 'saving' && (
            <span className="squisq-image-edit-modal__status" role="status">
              Saving…
            </span>
          )}
          <button
            type="button"
            className="squisq-image-edit-modal__close"
            data-testid="image-edit-modal-close"
            onClick={handleCloseRequest}
            disabled={closeState === 'saving'}
            aria-label={
              closeState === 'failed' ? 'Close without saving' : 'Save and close image editor'
            }
          >
            ×
          </button>
        </header>
        {closeState === 'failed' && (
          <div className="squisq-image-edit-modal__notice" role="status">
            Your edits weren’t saved to the image. Tap × again to close without saving them.
          </div>
        )}
        <div className="squisq-image-edit-modal__body">
          {resolveError ? (
            <div className="squisq-image-edit-modal__error">
              Failed to load image: {resolveError}
            </div>
          ) : !saveFormat ? (
            <div className="squisq-image-edit-modal__error">
              Editing supports PNG, JPEG, and WebP images without changing the asset type.
            </div>
          ) : !initialSrc ? (
            <div className="squisq-image-edit-modal__loading">Loading image…</div>
          ) : (
            <ImageEditor
              ref={editorRef}
              filesContainer={sidecar}
              initialSrc={initialSrc}
              allowVersioning={allowVersioning}
              versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
              onExport={handleExport}
              saveBehavior="export"
              saveFormat={saveFormat}
              saveLabel="Save and close"
              saveTitle="Save changes back to the image and close"
              surface={shellTheme === 'dark' ? DARK_SURFACE : LIGHT_SURFACE}
            />
          )}
        </div>
      </div>
    </div>
  );
}
