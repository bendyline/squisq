/**
 * DropZoneOverlay
 *
 * Full-editor overlay that appears when files are dragged over the editor.
 * Shows contextual drop zones depending on the type of files being dragged:
 * - Media files → single "Media" drop zone
 * - Text files → two zones: "Insert" (at cursor) and "Replace" (all content)
 * - Mixed files → all three zones
 */

import { useState } from 'react';
import type { DragContentType, DropTarget, UseFileDropResult } from './hooks/useFileDrop';

export interface DropZoneOverlayProps {
  /** What kind of content is being dragged */
  dragContentType: DragContentType;
  /** Factory that creates event props for a specific drop target */
  zoneProps: UseFileDropResult['zoneProps'];
  /** Whether a MediaProvider is available (disables media zone when false) */
  hasMediaProvider: boolean;
}

/**
 * Full-size overlay with contextual drop targets for file uploads.
 * Rendered conditionally by EditorShell when files are dragged over the editor.
 */
export function DropZoneOverlay({
  dragContentType,
  zoneProps,
  hasMediaProvider,
}: DropZoneOverlayProps) {
  const showMedia = dragContentType === 'media' || dragContentType === 'mixed';
  const showText = dragContentType === 'text' || dragContentType === 'mixed';

  return (
    <div className="squisq-drop-overlay">
      <div className="squisq-drop-overlay-inner">
        {showMedia && (
          <DropZone
            target="media"
            zoneProps={zoneProps}
            icon="📷"
            label="Media"
            description={hasMediaProvider ? 'Add to file bin' : 'No file storage configured'}
            disabled={!hasMediaProvider}
            variant="media"
          />
        )}
        {showText && (
          <>
            <DropZone
              target="insert"
              zoneProps={zoneProps}
              icon="📋"
              label="Insert"
              description="Insert content at cursor"
              variant="insert"
            />
            <DropZone
              target="replace"
              zoneProps={zoneProps}
              icon="🔄"
              label="Replace"
              description="Replace all editor content"
              variant="replace"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Individual drop zone ────────────────────────────────

interface DropZoneProps {
  target: DropTarget;
  zoneProps: UseFileDropResult['zoneProps'];
  icon: string;
  label: string;
  description: string;
  disabled?: boolean;
  variant: 'media' | 'insert' | 'replace';
}

function DropZone({
  target,
  zoneProps,
  icon,
  label,
  description,
  disabled,
  variant,
}: DropZoneProps) {
  const [isHovering, setIsHovering] = useState(false);
  const props = zoneProps(target);

  return (
    <div
      className={[
        'squisq-drop-zone',
        `squisq-drop-zone--${variant}`,
        isHovering && !disabled ? 'squisq-drop-zone--active' : '',
        disabled ? 'squisq-drop-zone--disabled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        props.onDragOver(e);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled) setIsHovering(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsHovering(false);
      }}
      onDrop={(e) => {
        setIsHovering(false);
        if (disabled) {
          e.preventDefault();
          return;
        }
        props.onDrop(e);
      }}
    >
      <span className="squisq-drop-zone-icon">{icon}</span>
      <span className="squisq-drop-zone-label">{label}</span>
      <span className="squisq-drop-zone-desc">{description}</span>
    </div>
  );
}
