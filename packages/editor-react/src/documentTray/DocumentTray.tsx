import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { videoEmbedIframeAttributes } from '@bendyline/squisq/markdown';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useEditorContextOptional } from '../EditorContext';
import { Icon } from '../Icon';
import type { SpeechRecognizerAccess } from '../speech/types';
import { AudioMedia } from '../tiptap/TiptapAudio';
import { VideoMedia } from '../tiptap/TiptapVideo';
import { DOCUMENT_TRAY_KEY, type DocumentTrayItem } from './DocumentTrayExtension';
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

/** View-only tray: opening/collapsing a pill never dispatches a transaction. */
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
  if (!state?.items.length) return null;
  const timing = recognizer?.readiness?.state === 'unavailable' ? null : timingAccess;
  return (
    <section className="squisq-document-tray" aria-label="Document tray">
      <div className="squisq-document-tray-heading">
        <span>Document media</span>
        <span className="squisq-document-tray-hint">Audio & video before the body</span>
      </div>
      <div className="squisq-document-tray-items">
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
