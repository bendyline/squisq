import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DARK_SURFACE, LIGHT_SURFACE, type MediaProvider } from '@bendyline/squisq/schemas';
import {
  MemoryContentContainer,
  scopeContainer,
  type ContentContainer,
} from '@bendyline/squisq/storage';
import { ImageEditor } from '../ImageEditor';
import { useModalDialog } from '../modal/useModalDialog';

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
  useModalDialog({ rootRef: modalRef, dialogRef: surfaceRef, onClose });
  const extension = relativePath.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase();
  const saveFormat: 'png' | 'jpeg' | 'webp' | null =
    extension === 'png'
      ? 'png'
      : extension === 'jpg' || extension === 'jpeg'
        ? 'jpeg'
        : extension === 'webp'
          ? 'webp'
          : null;
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

  const handleExport = useCallback(
    (blob: Blob, format: 'png' | 'jpeg' | 'webp') => {
      const mime = `image/${format}`;
      mediaProvider.addMedia(relativePath, blob, mime).then(
        () => onSaved(),
        (err: unknown) => {
          console.error('Failed to write image back:', err instanceof Error ? err.message : err);
        },
      );
    },
    [mediaProvider, relativePath, onSaved],
  );

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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={surfaceRef} className="squisq-image-edit-modal__surface">
        <header className="squisq-image-edit-modal__header">
          <span className="squisq-image-edit-modal__title">Edit image</span>
          <span className="squisq-image-edit-modal__path">{relativePath}</span>
          <button
            type="button"
            className="squisq-image-edit-modal__close"
            data-testid="image-edit-modal-close"
            onClick={onClose}
            aria-label="Close image editor"
          >
            ×
          </button>
        </header>
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
