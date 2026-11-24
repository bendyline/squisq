/**
 * ImageFileEditor — edits an image *file* in place, outside-in.
 *
 * The picture (`photo.png`) stays the file people see and share. Its layers
 * live in a sidecar container the host scopes for that one file (DocBlocks
 * uses `photo.png_files/`). Save flattens the layers back over the picture
 * in the file's own format, and leaving the editor (switching files,
 * closing) writes back any edits the picture is still missing, so the file
 * and its layers never disagree for long.
 *
 * Before the editor mounts, the sidecar is checked against the picture.
 * When the picture was replaced outside the editor since the last write
 * (or, for untouched layers, since they were seeded), the layers are
 * dropped and re-seeded from the current picture: stale layers are never
 * flattened over a newer picture.
 *
 * Animated images, and formats the raster editor cannot save back (GIF,
 * SVG, AVIF, BMP, ICO), render the host's `fallback` instead.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { exportImageEditDoc, type ImageEditExportFormat } from '@bendyline/squisq/imageEdit';
import {
  DEFAULT_INTERACTIVE_RESOURCE_POLICY,
  fetchResourceBytes,
} from '@bendyline/squisq/markdown';
import type { ImageEditDoc, SurfaceScheme } from '@bendyline/squisq/schemas';
import { ImageEditor, type ImageEditorHandle } from '../ImageEditor';
import { useImageEditorTokens } from './useImageEditorTokens';
import { prepareImageFileSidecar } from './imageFileSidecar';
import {
  digestBytes,
  imageEditSignature,
  imageSaveFormatForPath,
  needsWriteBack,
  writeWriteBackSignature,
} from './writeBack';

export interface ImageFileEditorProps {
  /**
   * Sidecar container for this one image file, e.g.
   * `scopeContainer(parent, 'photo.png_files')`. A different container (or
   * file name) starts a new editing session; the old one writes back first.
   */
  container: ContentContainer;
  /**
   * URL of the picture's current bytes. Read when a session starts; later
   * changes are ignored, so a host re-reading the file it was just handed
   * does not reload the editor and lose the user's place.
   */
  src: string;
  /** The image file's name or path. Its extension picks the save format. */
  fileName: string;
  /**
   * Write the flattened picture over the image file, in `format`. `reason`
   * is `'save'` for the Save button, where a rejection shows in the editor
   * as a failed save, and `'leave'` when the editor goes away with edits the
   * picture lacks. Nothing is on screen to show a failure then, so report a
   * `'leave'` failure from here.
   */
  onWriteBack: (
    blob: Blob,
    format: ImageEditExportFormat,
    context: ImageWriteBackContext,
  ) => Promise<void>;
  /** Version-history snapshots in the sidecar's `.versions/`. Default: `false`. */
  allowVersioning?: boolean;
  /** Auto-save idle delay (ms) for version snapshots. */
  versioningAutoSaveIdleMs?: number;
  /** Surface scheme for the editor chrome. */
  surface?: SurfaceScheme | 'auto';
  /** Shown instead of the editor when the picture cannot be edited. */
  fallback: ReactNode;
}

/** Why `ImageFileEditor` is writing the picture back. */
export interface ImageWriteBackContext {
  reason: 'save' | 'leave';
}

export function ImageFileEditor(props: ImageFileEditorProps) {
  return (
    <ImageFileEditorSession key={`${containerKey(props.container)}:${props.fileName}`} {...props} />
  );
}

const containerKeys = new WeakMap<ContentContainer, number>();
let nextContainerKey = 0;
function containerKey(container: ContentContainer): number {
  let key = containerKeys.get(container);
  if (key === undefined) {
    nextContainerKey += 1;
    key = nextContainerKey;
    containerKeys.set(container, key);
  }
  return key;
}

type Phase = 'preparing' | 'ready' | 'unavailable';

function ImageFileEditorSession({
  container,
  src,
  fileName,
  onWriteBack,
  allowVersioning = false,
  versioningAutoSaveIdleMs,
  surface,
  fallback,
}: ImageFileEditorProps) {
  const format = imageSaveFormatForPath(fileName);
  const tokens = useImageEditorTokens(undefined, surface);
  const [seedSrc] = useState(src);
  const [phase, setPhase] = useState<Phase>(format ? 'preparing' : 'unavailable');

  // Signature of the layer state the picture currently shows.
  const writtenRef = useRef<string | null>(null);
  const onWriteBackRef = useRef(onWriteBack);
  onWriteBackRef.current = onWriteBack;
  // Write-backs run one at a time, so a leave that lands during a Save sees
  // what that Save wrote instead of writing the same picture again.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const handleRef = useRef<ImageEditorHandle | null>(null);
  const setHandle = useCallback((handle: ImageEditorHandle | null) => {
    // Kept after unmount: leaving reads the final layers from it.
    if (handle) handleRef.current = handle;
  }, []);

  useEffect(() => {
    if (!format) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const resource = await fetchResourceBytes(seedSrc, {
        policy: DEFAULT_INTERACTIVE_RESOURCE_POLICY,
        signal: controller.signal,
        contentTypePrefixes: ['image/', 'application/octet-stream'],
      });
      if (cancelled) return;
      const prepared = await prepareImageFileSidecar(container, resource.bytes, () => cancelled);
      if (cancelled || prepared.kind === 'cancelled') return;
      if (prepared.kind === 'animated') {
        setPhase('unavailable');
        return;
      }
      writtenRef.current = prepared.written;
      setPhase('ready');
    })().catch((err: unknown) => {
      if (cancelled) return;
      console.warn(
        '[squisq-editor] image file could not be opened for editing:',
        err instanceof Error ? err.message : err,
      );
      setPhase('unavailable');
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [container, seedSrc, format]);

  const enqueue = useCallback((task: () => Promise<void>): Promise<void> => {
    const run = queueRef.current.catch(() => undefined).then(task);
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const writeBack = useCallback(
    async (
      blob: Blob,
      saveFormat: ImageEditExportFormat,
      doc: ImageEditDoc,
      reason: ImageWriteBackContext['reason'],
    ) => {
      await onWriteBackRef.current(blob, saveFormat, { reason });
      const signature = imageEditSignature(doc);
      writtenRef.current = signature;
      try {
        const pictureDigest = digestBytes(await blob.arrayBuffer());
        await writeWriteBackSignature(container, signature, pictureDigest);
      } catch (err: unknown) {
        // The picture is saved. Without the record, the next session cannot
        // vouch for these layers and re-seeds from the picture, which already
        // shows them flattened.
        console.warn(
          '[squisq-editor] image write-back record failed:',
          err instanceof Error ? err.message : err,
        );
      }
    },
    [container],
  );

  const handleExport = useCallback(
    (blob: Blob, saveFormat: ImageEditExportFormat, doc: ImageEditDoc) =>
      enqueue(() => writeBack(blob, saveFormat, doc, 'save')),
    [enqueue, writeBack],
  );

  // Leaving writes back whatever the picture is missing. The layers already
  // persist to the sidecar as the user works; without this, the file would
  // keep the old picture while reopening it showed the edits.
  useEffect(
    () => () => {
      const doc = handleRef.current?.getDoc() ?? null;
      if (!doc || !format) return;
      enqueue(async () => {
        if (!needsWriteBack(doc, writtenRef.current)) return;
        const blob = await exportImageEditDoc(doc, container, { format });
        await writeBack(blob, format, doc, 'leave');
      }).catch((err: unknown) => {
        console.warn(
          '[squisq-editor] image write-back on leave failed:',
          err instanceof Error ? err.message : err,
        );
      });
    },
    [container, enqueue, format, writeBack],
  );

  if (phase === 'unavailable' || !format) return <>{fallback}</>;
  if (phase === 'preparing') {
    return (
      <div className="squisq-image-editor" style={tokens.style}>
        <div className="squisq-image-editor-loading" role="status">
          Loading image…
        </div>
      </div>
    );
  }

  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  return (
    <ImageEditor
      ref={setHandle}
      className="squisq-image-file-editor"
      filesContainer={container}
      initialSrc={seedSrc}
      allowVersioning={allowVersioning}
      versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
      onExport={handleExport}
      saveBehavior="export"
      saveFormat={format}
      saveLabel="Save"
      saveTitle={`Save your changes to ${baseName}`}
      exportBasename={baseName.replace(/\.[^.]+$/, '') || 'image'}
      surface={surface}
    />
  );
}
