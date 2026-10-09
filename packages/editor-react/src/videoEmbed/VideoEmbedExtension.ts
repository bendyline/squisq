/**
 * VideoEmbedExtension — the Write view's inline player for hosted videos.
 *
 * A top-level paragraph that is nothing but a link (or bare URL) to a
 * YouTube, Vimeo, Loom, Dailymotion or Wistia page gets the provider's player
 * mounted ABOVE it. The paragraph itself stays in the document, visible and
 * editable, styled as the player's caption: edit its text to retitle the
 * video, edit the link (or the URL) to change it, delete it to remove the
 * player. Nothing about the video is stored anywhere but that paragraph, so
 * markdown round-trips byte-identically with the extension active.
 *
 * Structurally a sibling of `dataCard/DataCardExtension`: the same paragraph
 * position registry (`mapFenceEntries`) gives each player a stable session id,
 * so typing elsewhere never reloads an iframe. The widget is keyed by that id
 * PLUS the embed URL, so changing the link swaps the player.
 *
 * A raw `<iframe>` embed line (pasted into the Source view, or written by
 * another tool) plays too; its caption is the HTML, and the player offers to
 * rewrite it as a plain link.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { videoEmbedIframeAttributes, type BlockVideoEmbed } from '@bendyline/squisq/markdown';
import { mapFenceEntries, type FenceBlockEntry } from '../fenceWidgets/fenceRegistry';
import { videoEmbedOfParagraph, videoEmbedParagraphNode } from './videoEmbedParagraph';

export type VideoEmbedBlockEntry = FenceBlockEntry;

export interface VideoEmbedPluginState {
  entries: VideoEmbedBlockEntry[];
  decorations: DecorationSet;
  seq: number;
}

export interface VideoEmbedExtensionOptions {
  /** When false, the extension is inert and video links stay plain links. */
  enabled?: boolean;
}

export const VIDEO_EMBED_KEY = new PluginKey<VideoEmbedPluginState>('squisq-video-embed');

/** Document position of a registered video paragraph, by session id. */
export function findVideoEmbedBlockPos(state: EditorState, blockId: string): number | null {
  return VIDEO_EMBED_KEY.getState(state)?.entries.find((e) => e.id === blockId)?.pos ?? null;
}

/**
 * Rewrite a raw `<iframe>` embed paragraph as the plain-link form, in one
 * undoable transaction. False when the block is gone or no longer HTML.
 */
export function convertVideoEmbedToLink(view: EditorView, blockId: string): boolean {
  const pos = findVideoEmbedBlockPos(view.state, blockId);
  const node = pos === null ? null : view.state.doc.nodeAt(pos);
  const found = node ? videoEmbedOfParagraph(node) : null;
  if (pos === null || !node || found?.form !== 'iframe') return false;
  const replacement = videoEmbedParagraphNode(view.state.schema, found.embed.watchUrl, found.title);
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, replacement));
  return true;
}

function createPlayer(video: BlockVideoEmbed, blockId: string, view: EditorView): HTMLElement {
  const { embed } = video;
  const host = document.createElement('div');
  host.className = 'squisq-video-embed-host';
  host.setAttribute('contenteditable', 'false');
  host.dataset.provider = embed.provider;
  host.dataset.orientation = embed.aspectRatio < 1 ? 'portrait' : 'landscape';

  const frame = document.createElement('div');
  frame.className = 'squisq-video-embed-host-frame';
  frame.style.aspectRatio = embed.aspectRatio < 1 ? '9 / 16' : '16 / 9';
  const iframe = document.createElement('iframe');
  for (const [name, value] of Object.entries(videoEmbedIframeAttributes(embed, video.title))) {
    iframe.setAttribute(name, value);
  }
  frame.append(iframe);
  host.append(frame);

  if (video.form === 'iframe' && view.editable) {
    const bar = document.createElement('div');
    bar.className = 'squisq-video-embed-host-bar';
    const note = document.createElement('span');
    note.textContent = `${embed.providerName} embed code`;
    const convert = document.createElement('button');
    convert.type = 'button';
    convert.className = 'squisq-video-embed-host-convert';
    convert.textContent = 'Use a link instead';
    convert.title = 'Replace the HTML with a link to the video, which plays the same way';
    convert.addEventListener('click', () => {
      convertVideoEmbedToLink(view, blockId);
      view.focus();
    });
    bar.append(note, convert);
    host.append(bar);
  }
  return host;
}

function buildDecorations(
  doc: PMNode,
  entries: VideoEmbedBlockEntry[],
  view: () => EditorView | null,
): DecorationSet {
  const decos: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    const video = node ? videoEmbedOfParagraph(node) : null;
    if (!node || !video) continue;
    decos.push(
      Decoration.node(entry.pos, entry.pos + node.nodeSize, {
        class: `squisq-video-embed-caption${video.form === 'iframe' ? ' squisq-video-embed-caption--html' : ''}`,
      }),
    );
    const blockId = entry.id;
    decos.push(
      Decoration.widget(
        entry.pos,
        () => {
          const editorView = view();
          // The view exists before any decoration is drawn; this only guards
          // the type, and an empty host is harmless.
          if (!editorView) return document.createElement('div');
          return createPlayer(video, blockId, editorView);
        },
        {
          side: -1,
          ignoreSelection: true,
          // The player is an island: clicks and keys inside it are not edits.
          stopEvent: () => true,
          // Session id keeps the iframe alive across edits; the URL and form
          // in the key swap the player when the link (or its kind) changes.
          key: `squisq-video-embed-${blockId}|${video.embed.embedUrl}|${video.form === 'iframe' ? 'html' : 'md'}`,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

/** Top-level paragraphs only: a video link in a list or quote stays a link. */
function collectEntries(
  doc: PMNode,
  mapped: Map<number, string> | null,
  seqStart: number,
): { entries: VideoEmbedBlockEntry[]; seq: number } {
  let seq = seqStart;
  const entries: VideoEmbedBlockEntry[] = [];
  doc.forEach((node, pos) => {
    if (!videoEmbedOfParagraph(node)) return;
    entries.push({ id: mapped?.get(pos) ?? `video-embed-${++seq}`, pos });
  });
  return { entries, seq };
}

function applyState(
  tr: Transaction,
  prev: VideoEmbedPluginState,
  doc: PMNode,
  view: () => EditorView | null,
): VideoEmbedPluginState {
  if (!tr.docChanged) return prev;
  const mapped = mapFenceEntries(tr, prev.entries, doc, 'paragraph');
  const { entries, seq } = collectEntries(doc, mapped, prev.seq);
  return { entries, seq, decorations: buildDecorations(doc, entries, view) };
}

export const VideoEmbedExtension = Extension.create<VideoEmbedExtensionOptions>({
  name: 'squisqVideoEmbed',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    if (this.options.enabled === false) return [];
    // Widgets render lazily, after the view exists; read it then.
    const editor = this.editor;
    const view = (): EditorView | null => (editor.isDestroyed ? null : editor.view);

    return [
      new Plugin<VideoEmbedPluginState>({
        key: VIDEO_EMBED_KEY,
        state: {
          init: (_config, state) => {
            const { entries, seq } = collectEntries(state.doc, null, 0);
            return { entries, seq, decorations: buildDecorations(state.doc, entries, view) };
          },
          apply: (tr, prev, _oldState, newState) => applyState(tr, prev, newState.doc, view),
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export default VideoEmbedExtension;
