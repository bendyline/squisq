/**
 * "Edit audio" affordance for media node views. Renders nothing outside an
 * editor that supports media edits (no provider, or the host disabled them).
 * While the clip's cleanup recipe is rendering in the background, the button
 * carries a spinner and the render's progress.
 */

import { useMediaEditStatus } from '@bendyline/squisq-video-react/media-edit';
import { useEditorContextOptional } from '../EditorContext';
import { useFxClip } from './usePlaybackSrc';

export interface MediaEditButtonProps {
  src: string;
  kind: 'audio' | 'video';
  /** The node's current `fx` recipe, if any — marks the button as edited. */
  fx?: string | null;
  className?: string;
}

export function MediaEditButton({ src, kind, fx, className }: MediaEditButtonProps) {
  const editor = useEditorContextOptional();
  const manager = editor?.mediaEditRenders;
  const statusOf = useMediaEditStatus(manager);
  const clip = useFxClip(src, kind, fx);
  if (!editor || !manager || !src) return null;
  // Only an active render: a clip reads "queued" until the render index
  // loads, and a spinner on every processed clip at open would be noise.
  const status = clip ? statusOf(clip) : null;
  const progress =
    status?.state === 'rendering' ? `${Math.round((status.progress ?? 0) * 100)}%` : null;
  return (
    <button
      type="button"
      className={`squisq-media-edit-button ${className ?? ''}`.trim()}
      data-edited={fx ? 'true' : 'false'}
      data-processing={progress ? 'true' : undefined}
      title={
        kind === 'video'
          ? 'Clean up audio, shorten pauses, trim and crop this clip'
          : 'Clean up audio and shorten pauses'
      }
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => editor.openMediaEdit({ src, kind })}
    >
      {kind === 'video' ? 'Edit clip' : 'Edit audio'}
      {progress && (
        <>
          <span className="squisq-media-edit-button__spinner" aria-hidden="true" />
          <span className="squisq-media-edit-button__progress">
            <span className="squisq-sr-only">, processing </span>
            {progress}
          </span>
        </>
      )}
    </button>
  );
}
