/**
 * MediaEditModal — non-destructive edits for one media clip.
 *
 * Tabs: audio cleanup (the fixed signal chain, rendered in the background
 * into a processed track), timing (pause tightening, volume, fades) and, for
 * video, frame (crop) — the last two applied at playback and export. Every
 * panel stays mounted while its tab is hidden, so an in-flight preview or
 * pause search survives a tab switch. Nothing touches the source file: Apply
 * writes the recipe onto the clip's markdown in one undo step, sharing the
 * signal chain and cuts with grouped companion clips so a screen + camera pair
 * stays in sync.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  useMediaEditStatus,
  type MediaEditRenderManager,
  type MediaEditRenderStatus,
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
  fxFromDraft,
  type RecipeDraft,
} from './mediaEditDraft';
import { findEditableMedia, groupCompanions, type EditableMedia } from './mediaEditTargets';

export interface MediaEditModalProps {
  target: MediaEditTarget;
  onClose: () => void;
}

type MediaEditTab = 'audio' | 'timing' | 'frame';

const TABS: ReadonlyArray<{ id: MediaEditTab; label: string }> = [
  { id: 'audio', label: 'Audio cleanup' },
  { id: 'timing', label: 'Timing' },
  { id: 'frame', label: 'Frame' },
];

/** Whether a tab's settings would write anything — flagged on the tab, since hidden panels hide it. */
function tabHasEdits(tab: MediaEditTab, draft: RecipeDraft): boolean {
  switch (tab) {
    case 'audio':
      return fxFromDraft(draft).ops.length > 0 || draft.unknownFx.length > 0;
    case 'timing':
      return draft.cuts.length > 0 || draft.gain !== 0 || draft.fadeIn > 0 || draft.fadeOut > 0;
    case 'frame':
      return draft.crop != null;
  }
}

/** The background render of the clip's SAVED cleanup recipe, when it has one. */
function useRenderStatus(
  item: EditableMedia | null,
  manager: MediaEditRenderManager | null | undefined,
): MediaEditRenderStatus | null {
  const statusOf = useMediaEditStatus(manager);
  return item?.edits?.fx ? statusOf(item.clip) : null;
}

const percent = (status: MediaEditRenderStatus) => `${Math.round((status.progress ?? 0) * 100)}%`;

/** Compact form for the title bar; the footer carries the full status and Retry. */
function RenderStatusBadge({ status }: { status: MediaEditRenderStatus }) {
  return (
    <span className="squisq-media-edit-badge" data-state={status.state}>
      {status.state === 'ready' && 'Processed'}
      {status.state === 'queued' && 'Queued'}
      {status.state === 'rendering' && `Processing ${percent(status)}`}
      {status.state === 'failed' && 'Processing failed'}
    </span>
  );
}

function RenderStatusText({
  status,
  onRetry,
}: {
  status: MediaEditRenderStatus;
  onRetry: () => void;
}) {
  switch (status.state) {
    case 'ready':
      return <>Processed audio is in use.</>;
    case 'queued':
      return <>Waiting to process…</>;
    case 'rendering':
      return <>Processing… {percent(status)}</>;
    case 'failed':
      return (
        <>
          Processing failed: {status.error}{' '}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </>
      );
  }
}

export function MediaEditModal({ target, onClose }: MediaEditModalProps) {
  const { doc, markdownSource, setMarkdownSource, mediaEditRenders } = useEditorContext();
  const modalRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog({ rootRef: modalRef, dialogRef: surfaceRef, onClose });

  const item = useMemo(() => (doc ? findEditableMedia(doc, target) : null), [doc, target]);
  const companions = useMemo(() => (doc && item ? groupCompanions(doc, item) : []), [doc, item]);
  const renderStatus = useRenderStatus(item, mediaEditRenders);

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

  const tabs = TABS.filter((t) => t.id !== 'frame' || item?.kind === 'video');
  const [activeTab, setActiveTab] = useState<MediaEditTab>('audio');
  const tabRefs = useRef(new Map<MediaEditTab, HTMLButtonElement>());
  const onTabKeyDown = (event: ReactKeyboardEvent, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next == null) return;
    event.preventDefault();
    const id = tabs[next]!.id;
    setActiveTab(id);
    tabRefs.current.get(id)?.focus();
  };

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
  const tabbed = item != null && mediaEditRenders != null;
  const tabId = (tab: MediaEditTab) => `${titleId}-tab-${tab}`;
  const panelId = (tab: MediaEditTab) => `${titleId}-panel-${tab}`;
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
        className={`squisq-media-edit-modal__surface${tabbed ? ' squisq-media-edit-modal__surface--tabbed' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="squisq-media-edit-modal__header">
          <span id={titleId} className="squisq-media-edit-modal__title">
            {title}
          </span>
          <span className="squisq-media-edit-modal__path">{target.src}</span>
          {renderStatus && <RenderStatusBadge status={renderStatus} />}
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
          <>
            <div className="squisq-media-edit-tabs" role="tablist" aria-label="Edit sections">
              {tabs.map((tab, index) => {
                const selected = tab.id === activeTab;
                const edited = tabHasEdits(tab.id, draft);
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      if (el) tabRefs.current.set(tab.id, el);
                      else tabRefs.current.delete(tab.id);
                    }}
                    type="button"
                    role="tab"
                    id={tabId(tab.id)}
                    className="squisq-media-edit-tab"
                    aria-selected={selected}
                    aria-controls={panelId(tab.id)}
                    tabIndex={selected ? 0 : -1}
                    data-edited={edited ? 'true' : undefined}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(e) => onTabKeyDown(e, index)}
                  >
                    {tab.label}
                    {edited && <span className="squisq-sr-only"> (edited)</span>}
                  </button>
                );
              })}
            </div>
            <div className="squisq-media-edit-modal__body">
              <div
                role="tabpanel"
                id={panelId('audio')}
                aria-labelledby={tabId('audio')}
                hidden={activeTab !== 'audio'}
              >
                <MediaEditAudioSection
                  item={item}
                  draft={draft}
                  onChange={setDraft}
                  manager={mediaEditRenders}
                  idPrefix={titleId}
                />
              </div>
              <div
                role="tabpanel"
                id={panelId('timing')}
                aria-labelledby={tabId('timing')}
                hidden={activeTab !== 'timing'}
              >
                <MediaEditTimingSection
                  item={item}
                  draft={draft}
                  onChange={setDraft}
                  manager={mediaEditRenders}
                  idPrefix={titleId}
                />
              </div>
              {item.kind === 'video' && (
                <div
                  role="tabpanel"
                  id={panelId('frame')}
                  aria-labelledby={tabId('frame')}
                  hidden={activeTab !== 'frame'}
                >
                  <MediaEditFrameSection item={item} draft={draft} onChange={setDraft} />
                </div>
              )}
              {companions.length > 0 && (
                <p className="squisq-media-edit-note">
                  Cleanup and pause cuts also apply to {companions.length} linked{' '}
                  {companions.length === 1 ? 'clip' : 'clips'} from the same recording.
                </p>
              )}
            </div>
          </>
        )}

        <footer className="squisq-media-edit-modal__footer">
          {/* Always mounted: a live region must exist before its content changes. */}
          <p className="squisq-media-edit-status" role="status" data-state={renderStatus?.state}>
            {renderStatus && item && mediaEditRenders && (
              <RenderStatusText
                status={renderStatus}
                onRetry={() => mediaEditRenders.retry(item.clip)}
              />
            )}
          </p>
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
