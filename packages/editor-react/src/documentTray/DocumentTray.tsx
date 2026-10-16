import { useCallback, useId, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { videoEmbedIframeAttributes } from '@bendyline/squisq/markdown';
import { Icon } from '../Icon';
import { AudioMedia } from '../tiptap/TiptapAudio';
import { VideoMedia } from '../tiptap/TiptapVideo';
import { DOCUMENT_TRAY_KEY, type DocumentTrayItem } from './DocumentTrayExtension';

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

function TrayItem({ item, editor }: { item: DocumentTrayItem; editor: Editor }) {
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
  if (!state?.items.length) return null;
  return (
    <section className="squisq-document-tray" aria-label="Document tray">
      <div className="squisq-document-tray-heading">
        <span>Document media</span>
        <span className="squisq-document-tray-hint">Audio & video before the body</span>
      </div>
      <div className="squisq-document-tray-items">
        {state.items.map((item) => (
          <TrayItem key={item.id} item={item} editor={editor} />
        ))}
      </div>
    </section>
  );
}
