import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { splitFrontmatterBlock, videoEmbedIframeAttributes } from '@bendyline/squisq/markdown';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useEditorContextOptional } from '../EditorContext';
import { Icon } from '../Icon';
import type { SpeechRecognizerAccess } from '../speech/types';
import { AudioMedia } from '../tiptap/TiptapAudio';
import { VideoMedia } from '../tiptap/TiptapVideo';
import {
  applyPropertyEdits,
  readCustomProperties,
  type PropertyEditPlan,
} from '../frontmatterProperties';
import { DOCUMENT_TRAY_KEY, type DocumentTrayItem } from './DocumentTrayExtension';
import { PropertiesTrayItem } from './PropertiesTrayItem';
import {
  cancelNarrationTimingJob,
  narrationTimingJob,
  startNarrationTimingJob,
  subscribeNarrationTimingJobs,
} from './narrationTimingJobs';
import type { NarrationTimingProgress } from './narrationTimingsFromAudio';

/** What timing a narration from its audio needs; null when the host can't. */
interface NarrationTimingAccess {
  recognizer: SpeechRecognizerAccess;
  container: ContentContainer;
  mediaProvider: MediaProvider;
  getMarkdownSource: () => string;
  onSaved: () => void;
}

function progressLabel({ phase, fraction }: NarrationTimingProgress): string {
  if (phase === 'reading') return 'Reading the recording…';
  if (phase === 'transcribing')
    return `Updating timings from audio… ${Math.round(fraction * 100)}%`;
  if (phase === 'matching') return 'Matching words to the document…';
  return 'Saving timings…';
}

function NarrationTimingControl({ src, access }: { src: string; access: NarrationTimingAccess }) {
  const { container, recognizer } = access;
  const getJob = useCallback(() => narrationTimingJob(container, src), [container, src]);
  const job = useSyncExternalStore(subscribeNarrationTimingJobs, getJob, getJob);
  const start = () => {
    if (recognizer.readiness?.state === 'download-required') {
      recognizer.provider.requestSetup?.();
      return;
    }
    startNarrationTimingJob({
      src,
      markdownSource: access.getMarkdownSource(),
      provider: recognizer.provider,
      container,
      mediaProvider: access.mediaProvider,
      onSaved: access.onSaved,
    });
  };
  if (job?.status === 'running') {
    return (
      <div className="squisq-document-tray-timing">
        <span role="status">{progressLabel(job.progress)}</span>
        <progress max={1} value={job.progress.fraction} aria-label="Timing progress" />
        <button type="button" onClick={() => cancelNarrationTimingJob(container, src)}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="squisq-document-tray-timing">
      <button
        type="button"
        onClick={start}
        title="Transcribe this recording and match its words to the document, so slides and captions follow the voice."
      >
        Update timings from audio
      </button>
      {job?.status === 'done' && (
        <span role="status">
          Timings updated · {job.result.matchedWords} of {job.result.spokenWords} words matched
        </span>
      )}
      {job?.status === 'error' && (
        <span role="alert" className="squisq-document-tray-timing-error">
          {job.message}
        </span>
      )}
    </div>
  );
}

function mediaLabel(item: DocumentTrayItem): string {
  if (item.title) return item.title;
  const path = item.src.split(/[?#]/, 1)[0];
  const name = path.split(/[\\/]/).pop() || item.kind;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function TrayItem({
  item,
  editor,
  timing,
}: {
  item: DocumentTrayItem;
  editor: Editor;
  timing: NarrationTimingAccess | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const label = mediaLabel(item);
  const kind = item.kind === 'audio' ? 'Audio' : 'Video';
  const readOnly = !editor.isEditable;
  // Resolve by session identity at the instant of the action. A body edit may
  // have moved this node since React last painted, and duplicate srcs are legal.
  const currentItem = () =>
    DOCUMENT_TRAY_KEY.getState(editor.state)?.items.find((entry) => entry.id === item.id);
  const updateAttributes = (attrs: Record<string, unknown>) => {
    const current = currentItem();
    if (!current || !editor.isEditable) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(current.pos, undefined, {
        ...current.node.attrs,
        ...attrs,
      }),
    );
  };
  const remove = () => {
    const current = currentItem();
    if (!current || !editor.isEditable) return;
    editor.view.dispatch(editor.state.tr.delete(current.pos, current.pos + current.node.nodeSize));
    editor.commands.focus();
  };
  return (
    <div className="squisq-document-tray-item" data-expanded={expanded || undefined}>
      <button
        type="button"
        className="squisq-document-tray-pill"
        id={`${id}-pill`}
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-panel` : undefined}
        aria-label={`${kind}: ${label}`}
        title={item.src}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon icon={`fa-solid ${item.kind === 'audio' ? 'fa-volume-high' : 'fa-film'}`} />
        <span className="squisq-document-tray-pill-label">{label}</span>
        <span className="squisq-document-tray-chevron" aria-hidden="true">
          {expanded ? '▴' : '▾'}
        </span>
      </button>
      {expanded && (
        <div
          className="squisq-document-tray-panel"
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-pill`}
          data-squisq-media-src={item.src}
          data-squisq-media-kind={item.kind}
        >
          {item.embed ? (
            <div
              className="squisq-video-embed-host-frame"
              style={{ aspectRatio: item.embed.embed.aspectRatio }}
            >
              <iframe {...videoEmbedIframeAttributes(item.embed.embed, item.embed.title)} />
            </div>
          ) : item.kind === 'audio' ? (
            <AudioMedia attrs={item.attrs} readOnly={readOnly} />
          ) : (
            <VideoMedia
              attrs={item.attrs}
              readOnly={readOnly}
              updateAttributes={item.editableAttributes ? updateAttributes : undefined}
            />
          )}
          {timing && !readOnly && <NarrationTimingControl src={item.src} access={timing} />}
          <div className="squisq-document-tray-detail">
            <span title={item.src}>{item.src}</span>
            {!readOnly && (
              <button type="button" onClick={remove} aria-label={`Remove ${label} from document`}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * View-only tray: opening/collapsing a pill never dispatches a transaction.
 *
 * It holds the document's opening media and, when the document has keys of
 * its own in its frontmatter, a Properties pill to edit them. Both show only
 * where the tray is enabled — the whole document, or the first block of a
 * block layout.
 */
export function DocumentTray({ editor }: { editor: Editor }) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      editor.on('transaction', onChange);
      return () => {
        editor.off('transaction', onChange);
      };
    },
    [editor],
  );
  const getSnapshot = useCallback(() => DOCUMENT_TRAY_KEY.getState(editor.state), [editor]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const context = useEditorContextOptional();
  // The context changes on every keystroke; keep what the players see stable.
  const markdownRef = useRef('');
  markdownRef.current = context?.markdownSource ?? '';
  const container = context?.workspaceContainer;
  const mediaProvider = context?.mediaProvider;
  const recognizer = context?.speechRecognizer;
  const onSaved = context?.bumpMediaRevision;
  const timingAccess = useMemo<NarrationTimingAccess | null>(
    () =>
      container && mediaProvider && recognizer && onSaved
        ? {
            recognizer,
            container,
            mediaProvider,
            getMarkdownSource: () => markdownRef.current,
            onSaved,
          }
        : null,
    [container, mediaProvider, recognizer, onSaved],
  );
  const documentMedia = context?.doc?.documentMedia;
  // Only the document-anchored narration take is timed from its audio.
  const narrationSources = useMemo(
    () =>
      new Set(
        (documentMedia ?? []).filter((clip) => clip.anchor === 'document').map((clip) => clip.src),
      ),
    [documentMedia],
  );
  // Re-read only when the frontmatter itself changes, not on every keystroke.
  const frontmatterBlock = splitFrontmatterBlock(markdownRef.current).frontmatter ?? '';
  const hostKeys = context?.hostFrontmatterKeys;
  const properties = useMemo(
    () => readCustomProperties(frontmatterBlock).filter((property) => !hostKeys?.has(property.key)),
    [frontmatterBlock, hostKeys],
  );
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const replaceAll = context?.replaceAll;
  const writeProperties = useCallback(
    (plan: PropertyEditPlan): boolean => {
      if (!replaceAll) return false;
      const source = markdownRef.current;
      const next = applyPropertyEdits(source, plan);
      if (next === source) return false;
      // One minimal edit: a single undo step that keeps the caret.
      replaceAll(next);
      return true;
    },
    [replaceAll],
  );

  const hasMedia = !!state?.items.length;
  // An open panel stays while it is open, so deleting the last property
  // doesn't pull it out from under the pointer.
  const showProperties =
    !!state?.enabled && !!replaceAll && (properties.length > 0 || propertiesOpen);
  if (!state || (!hasMedia && !showProperties)) return null;
  const timing = recognizer?.readiness?.state === 'unavailable' ? null : timingAccess;
  // The Properties pill names itself; a heading is only for the media.
  const heading = !hasMedia
    ? null
    : showProperties
      ? { title: 'Document', hint: 'Properties, and audio & video before the body' }
      : { title: 'Document media', hint: 'Audio & video before the body' };
  return (
    <section className="squisq-document-tray" aria-label="Document tray">
      {heading && (
        <div className="squisq-document-tray-heading">
          <span>{heading.title}</span>
          <span className="squisq-document-tray-hint">{heading.hint}</span>
        </div>
      )}
      <div className="squisq-document-tray-items">
        {showProperties && (
          <PropertiesTrayItem
            properties={properties}
            expanded={propertiesOpen}
            onExpandedChange={setPropertiesOpen}
            readOnly={!editor.isEditable}
            write={writeProperties}
          />
        )}
        {state.items.map((item) => (
          <TrayItem
            key={item.id}
            item={item}
            editor={editor}
            timing={!item.embed && narrationSources.has(item.src) ? timing : null}
          />
        ))}
      </div>
    </section>
  );
}
