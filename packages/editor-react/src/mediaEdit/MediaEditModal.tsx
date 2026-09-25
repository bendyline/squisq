/**
 * MediaEditModal — non-destructive edits for one media clip.
 *
 * Sections: audio cleanup (the fixed signal chain, rendered in the background
 * into a processed track), timing (pause tightening, volume, fades) and, for
 * video, frame (crop) — the last two applied at playback and export. Nothing touches the source file: Apply writes the
 * recipe onto the clip's markdown in one undo step, sharing the signal chain
 * and cuts with grouped companion clips so a screen + camera pair stays in
 * sync.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  useMediaEditStatus,
  type MediaEditRenderManager,
} from '@bendyline/squisq-video-react/media-edit';
import { useEditorContext, type MediaEditTarget } from '../EditorContext';
import { useModalDialog } from '../modal/useModalDialog';
import { setMediaClipsInSource } from '../timelineSource';
import { MediaEditAudioSection } from './MediaEditAudioSection';
import { MediaEditTimingSection } from './MediaEditTimingSection';
import { MediaEditFrameSection } from './MediaEditFrameSection';
import {
  companionEdits,
  draftFromEdits,
  editsFromDraft,
  editsSignature,
  type RecipeDraft,
} from './mediaEditDraft';
import { findEditableMedia, groupCompanions, type EditableMedia } from './mediaEditTargets';

export interface MediaEditModalProps {
  target: MediaEditTarget;
  onClose: () => void;
}

function RenderStatus({ item, manager }: { item: EditableMedia; manager: MediaEditRenderManager }) {
  const statusOf = useMediaEditStatus(manager);
  if (!item.edits?.fx) return null;
  const status = statusOf(item.clip);
  if (!status) return null;
  return (
    <p className="squisq-media-edit-status" role="status" data-state={status.state}>
      {status.state === 'ready' && 'Processed audio is in use.'}
      {status.state === 'queued' && 'Waiting to process…'}
      {status.state === 'rendering' && `Processing… ${Math.round((status.progress ?? 0) * 100)}%`}
      {status.state === 'failed' && (
        <>
          Processing failed: {status.error}{' '}
          <button type="button" onClick={() => manager.retry(item.clip)}>
            Retry
          </button>
        </>
      )}
    </p>
  );
}

export function MediaEditModal({ target, onClose }: MediaEditModalProps) {
  const { doc, markdownSource, setMarkdownSource, mediaEditRenders } = useEditorContext();
  const modalRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog({ rootRef: modalRef, dialogRef: surfaceRef, onClose });

  const item = useMemo(() => (doc ? findEditableMedia(doc, target) : null), [doc, target]);
  const companions = useMemo(() => (doc && item ? groupCompanions(doc, item) : []), [doc, item]);

  const [draft, setDraft] = useState<RecipeDraft>(() => draftFromEdits(item?.edits));
  // The document parses asynchronously: seed the draft from the saved recipe
  // once the clip resolves (and again if that recipe changes underneath).
  const seedKey = item ? `${item.sourceLine}|${editsSignature(item.edits)}` : null;
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (seedKey === null || seededRef.current === seedKey) return;
    seededRef.current = seedKey;
    setDraft(draftFromEdits(item?.edits));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const nextEdits = item ? editsFromDraft(draft, item.edits) : null;
  const dirty = item != null && editsSignature(nextEdits) !== editsSignature(item.edits);

  const apply = useCallback(() => {
    if (!item) return;
    const patches = [
      { line: item.sourceLine, patch: { edits: editsFromDraft(draft, item.edits) } },
      ...companions.map((companion) => ({
        line: companion.sourceLine,
        patch: { edits: companionEdits(item, companion, draft) },
      })),
    ];
    const next = setMediaClipsInSource(markdownSource, patches);
    if (next != null) setMarkdownSource(next);
    onClose();
  }, [item, companions, draft, markdownSource, setMarkdownSource, onClose]);

  const title = target.kind === 'video' ? 'Edit clip' : 'Edit audio';
  return (
    <div
      ref={modalRef}
      className="squisq-media-edit-modal"
      data-testid="media-edit-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={surfaceRef}
        className="squisq-media-edit-modal__surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="squisq-media-edit-modal__header">
          <span id={titleId} className="squisq-media-edit-modal__title">
            {title}
          </span>
          <span className="squisq-media-edit-modal__path">{target.src}</span>
          <button
            type="button"
            className="squisq-media-edit-modal__close"
            onClick={onClose}
            aria-label={`Close: ${title}`}
          >
            ×
          </button>
        </header>

        {!item ? (
          <p className="squisq-media-edit-modal__empty">This clip is no longer in the document.</p>
        ) : !mediaEditRenders ? (
          <p className="squisq-media-edit-modal__empty">
            Media editing needs a media folder for this document.
          </p>
        ) : (
          <div className="squisq-media-edit-modal__body">
            <MediaEditAudioSection
              item={item}
              draft={draft}
              onChange={setDraft}
              manager={mediaEditRenders}
              idPrefix={titleId}
            />
            <MediaEditTimingSection
              item={item}
              draft={draft}
              onChange={setDraft}
              manager={mediaEditRenders}
              idPrefix={titleId}
            />
            {item.kind === 'video' && (
              <MediaEditFrameSection
                item={item}
                draft={draft}
                onChange={setDraft}
                idPrefix={titleId}
              />
            )}
            <RenderStatus item={item} manager={mediaEditRenders} />
            {companions.length > 0 && (
              <p className="squisq-media-edit-note">
                Cleanup and pause cuts also apply to {companions.length} linked{' '}
                {companions.length === 1 ? 'clip' : 'clips'} from the same recording.
              </p>
            )}
          </div>
        )}

        <footer className="squisq-media-edit-modal__footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="squisq-media-edit-modal__primary"
            disabled={!item || !mediaEditRenders || !dirty}
            onClick={apply}
          >
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}
