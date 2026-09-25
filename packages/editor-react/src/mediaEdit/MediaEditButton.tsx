/**
 * "Edit audio" affordance for media node views. Renders nothing outside an
 * editor that supports media edits (no provider, or the host disabled them).
 */

import { useEditorContextOptional } from '../EditorContext';

export interface MediaEditButtonProps {
  src: string;
  kind: 'audio' | 'video';
  /** The node's current `fx` recipe, if any — marks the button as edited. */
  fx?: string | null;
  className?: string;
}

export function MediaEditButton({ src, kind, fx, className }: MediaEditButtonProps) {
  const editor = useEditorContextOptional();
  if (!editor?.mediaEditRenders || !src) return null;
  const edited = Boolean(fx);
  return (
    <button
      type="button"
      className={`squisq-media-edit-button ${className ?? ''}`.trim()}
      data-edited={edited ? 'true' : 'false'}
      title={
        kind === 'video'
          ? 'Clean up audio, shorten pauses, trim and crop this clip'
          : 'Clean up audio and shorten pauses'
      }
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => editor.openMediaEdit({ src, kind })}
    >
      {kind === 'video' ? 'Edit clip' : 'Edit audio'}
    </button>
  );
}
