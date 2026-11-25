/**
 * Image mode: what EditorShell shows for an image file.
 *
 * `ImageModeHeader` replaces the markdown/code Toolbar with a bar of the
 * host's toolbar slots alone — view tabs, formatting, and preview controls
 * don't apply to a binary asset.
 *
 * `ImageModeSurface` is one of three surfaces, by what the host wired:
 *  - `ImageFileEditor` (outside-in: edits write back over the file) when
 *    editing with a sidecar container and an `onWriteBack` callback;
 *  - `ImageEditor` (layers in the sidecar, Export hands the host a raster)
 *    when editing with a container alone;
 *  - `ImageViewer` otherwise, and as the file editor's fallback for pictures
 *    it cannot save back (animated images, GIF, SVG, …).
 *
 * Its own module so the shell passes one element instead of threading every
 * image prop through EditorShellInner (EditorShell.tsx is at its line budget).
 */

import type { ReactNode } from 'react';
import type { ImageEditExportFormat } from '@bendyline/squisq/imageEdit';
import { DARK_SURFACE, LIGHT_SURFACE } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { ImageEditor } from '../ImageEditor';
import { ImageViewer } from '../ImageViewer';
import { DocumentActionsGroup } from '../toolbar/DocumentActions';
import { ImageFileEditor, type ImageWriteBack } from './ImageFileEditor';

export interface ImageModeHeaderProps {
  left?: ReactNode;
  quickTools?: ReactNode;
  documentActions?: ReactNode;
  right?: ReactNode;
  colorScheme: 'light' | 'dark';
}

/** The host's toolbar slots in one row; nothing when the host gave none. */
export function ImageModeHeader({
  left,
  quickTools,
  documentActions,
  right,
  colorScheme,
}: ImageModeHeaderProps) {
  if (!left && !quickTools && !documentActions && !right) return null;
  return (
    <div className="squisq-editor-header squisq-editor-header--image">
      {left}
      <div style={{ flex: 1 }} />
      {quickTools}
      {/* Nothing here measures the row, so the actions never fold. */}
      {documentActions && (
        <DocumentActionsGroup folded={false} colorScheme={colorScheme}>
          {documentActions}
        </DocumentActionsGroup>
      )}
      {right}
    </div>
  );
}

export interface ImageModeSurfaceProps {
  /** URL of the picture. */
  src: string;
  alt?: string;
  /** `'edit'` needs {@link container}; without it the picture is only viewed. */
  mode: 'view' | 'edit';
  /** The image file's sidecar container (layers, versions). */
  container?: ContentContainer;
  /** The image file's name; its extension picks the write-back format. */
  fileName?: string;
  /** Export target for the layered editor. Ignored when {@link onWriteBack} is set. */
  onExport?: (blob: Blob, format: ImageEditExportFormat) => void;
  /** Write the flattened picture back over the file (outside-in editing). */
  onWriteBack?: ImageWriteBack;
  allowVersioning: boolean;
  versioningAutoSaveIdleMs?: number;
  colorScheme: 'light' | 'dark';
}

export function ImageModeSurface({
  src,
  alt,
  mode,
  container,
  fileName,
  onExport,
  onWriteBack,
  allowVersioning,
  versioningAutoSaveIdleMs,
  colorScheme,
}: ImageModeSurfaceProps) {
  const viewer = <ImageViewer src={src} alt={alt} theme={colorScheme} />;
  if (mode !== 'edit' || !container) return viewer;
  const surface = colorScheme === 'dark' ? DARK_SURFACE : LIGHT_SURFACE;
  if (onWriteBack) {
    return (
      <ImageFileEditor
        container={container}
        src={src}
        fileName={fileName ?? ''}
        onWriteBack={onWriteBack}
        allowVersioning={allowVersioning}
        versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
        surface={surface}
        fallback={viewer}
      />
    );
  }
  return (
    <ImageEditor
      filesContainer={container}
      initialSrc={src}
      allowVersioning={allowVersioning}
      versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
      onExport={onExport}
      surface={surface}
    />
  );
}
