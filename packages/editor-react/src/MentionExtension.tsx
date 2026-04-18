/**
 * MentionExtension
 *
 * Tiptap mention configuration paired with a small absolutely-positioned
 * suggestion popover. Shares a caller-supplied async provider (see
 * `MentionProvider` in EditorContext) with the Monaco `@` completion
 * provider in `RawEditor`, so both editing modes surface the same roster.
 *
 * The mention chip renders as `<span data-mention data-kind data-id
 * data-label class="mention">@Label</span>`, matching the wire format that
 * `tiptapBridge` emits when converting markdown → Tiptap HTML. On serialize
 * back to markdown, the bridge emits `@[Label](kind:id)`.
 */

import Mention from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import type { Editor, Range } from '@tiptap/core';
import type { MentionCandidate, MentionProvider } from './EditorContext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SuggestionProps = any;

type SuggestionState = {
  items: MentionCandidate[];
  selected: number;
};

/**
 * Build the Tiptap mention extension for an editor. The returned extension
 * captures a reference to `getProvider` at configure-time and calls it on
 * every keystroke — keep the reference stable so we don't recreate the
 * editor just to change who answers the `@` query.
 */
export function buildMentionExtension(getProvider: () => MentionProvider | null) {
  return Mention.configure({
    HTMLAttributes: {
      class: 'mention',
      'data-mention': 'true',
    },
    renderHTML({ options, node }) {
      const label =
        (node.attrs.label as string | undefined) ??
        (node.attrs.id as string | undefined) ??
        '';
      const id = (node.attrs.id as string | undefined) ?? '';
      const kind = (node.attrs.kind as string | undefined) ?? 'gezel';
      return [
        'span',
        {
          ...options.HTMLAttributes,
          'data-kind': kind,
          'data-id': id,
          'data-label': label,
        },
        `@${label}`,
      ];
    },
    renderText({ node }) {
      const label =
        (node.attrs.label as string | undefined) ??
        (node.attrs.id as string | undefined) ??
        '';
      const id = (node.attrs.id as string | undefined) ?? '';
      const kind = (node.attrs.kind as string | undefined) ?? 'gezel';
      return `@[${label}](${kind}:${id})`;
    },
  }).extend({
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-id'),
          renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
        },
        label: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-label'),
          renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {}),
        },
        kind: {
          default: 'gezel',
          parseHTML: (el) => el.getAttribute('data-kind') ?? 'gezel',
          renderHTML: (attrs) => ({ 'data-kind': attrs.kind ?? 'gezel' }),
        },
      };
    },
    addOptions() {
      return {
        ...(this.parent?.() ?? {}),
        suggestion: {
          char: '@',
          // Custom plugin key so the mention suggestion doesn't collide
          // with any future `:` or `/` popovers.
          pluginKey: new PluginKey('mentionSuggestion'),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: any }) => {
            const id = (props?.id as string | null) ?? '';
            const label = (props?.label as string | null) ?? id;
            const kind = (props?.kind as string | undefined) ?? 'gezel';
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: 'mention',
                  attrs: { id, label, kind },
                },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
          items: async ({ query }: { query: string }) => {
            const provider = getProvider();
            if (!provider) return [];
            try {
              return await provider(query);
            } catch {
              return [];
            }
          },
          render: renderSuggestionFactory(),
        },
      };
    },
  });
}

/**
 * Lightweight suggestion popover. Uses a plain absolutely-positioned div
 * anchored to the caret rect — no tippy.js needed. Keyboard nav handled via
 * the `onKeyDown` hook Tiptap wires up.
 */
function renderSuggestionFactory() {
  return () => {
    let container: HTMLDivElement | null = null;
    let state: SuggestionState = { items: [], selected: 0 };
    let currentProps: SuggestionProps | null = null;

    const update = () => {
      if (!container || !currentProps) return;
      container.innerHTML = '';
      if (state.items.length === 0) {
        container.style.display = 'none';
        return;
      }
      container.style.display = 'block';

      for (let i = 0; i < state.items.length; i++) {
        const item = state.items[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'squisq-mention-item' + (i === state.selected ? ' is-selected' : '');
        btn.dataset.index = String(i);
        btn.innerHTML = '';
        const label = document.createElement('span');
        label.className = 'squisq-mention-label';
        label.textContent = item.label;
        btn.appendChild(label);
        if (item.description) {
          const desc = document.createElement('span');
          desc.className = 'squisq-mention-desc';
          desc.textContent = item.description;
          btn.appendChild(desc);
        }
        btn.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          selectAt(i);
        });
        container.appendChild(btn);
      }

      positionTo(container, currentProps.clientRect);
    };

    const selectAt = (index: number) => {
      const item = state.items[index];
      if (!item || !currentProps) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const command = (currentProps as any).command;
      if (typeof command === 'function') {
        command({ id: item.id, label: item.label, kind: 'gezel' });
      }
    };

    return {
      onStart: (props: SuggestionProps) => {
        currentProps = props;
        state = { items: props.items ?? [], selected: 0 };
        if (!container) {
          container = document.createElement('div');
          container.className = 'squisq-mention-popover';
          container.style.position = 'absolute';
          container.style.zIndex = '10000';
          document.body.appendChild(container);
        }
        update();
      },
      onUpdate: (props: SuggestionProps) => {
        currentProps = props;
        if (Array.isArray(props.items)) {
          state = { items: props.items, selected: 0 };
        }
        update();
      },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (!state.items.length) return false;
        if (event.key === 'ArrowDown') {
          state.selected = (state.selected + 1) % state.items.length;
          update();
          return true;
        }
        if (event.key === 'ArrowUp') {
          state.selected =
            (state.selected - 1 + state.items.length) % state.items.length;
          update();
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          selectAt(state.selected);
          return true;
        }
        if (event.key === 'Escape') {
          state = { items: [], selected: 0 };
          update();
          return true;
        }
        return false;
      },
      onExit: () => {
        if (container?.parentNode) container.parentNode.removeChild(container);
        container = null;
        currentProps = null;
      },
    };
  };
}

function positionTo(
  el: HTMLDivElement,
  clientRect: (() => DOMRect | null) | null | undefined,
): void {
  const rect = clientRect?.();
  if (!rect) return;
  // Anchor just below the caret; fall back to above when there's no room.
  const viewportH = window.innerHeight;
  const below = rect.bottom + 4;
  const estH = Math.min(240, el.offsetHeight || 200);
  const fitsBelow = below + estH < viewportH;
  el.style.left = `${rect.left + window.scrollX}px`;
  if (fitsBelow) {
    el.style.top = `${below + window.scrollY}px`;
  } else {
    el.style.top = `${rect.top + window.scrollY - estH - 4}px`;
  }
}
