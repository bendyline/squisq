import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { WikiLinkSupport, WikiLinkSuggestion } from '@bendyline/squisq/markdown';
import { wikiQueryAt, validWikiSuggestions } from './wikiSuggestions';

let nextListId = 0;

function matchAt(view: EditorView) {
  const { selection } = view.state;
  if (
    !selection.empty ||
    selection.$from.parent.type.spec.code ||
    selection.$from.marks().some((mark) => mark.type.name === 'code' || mark.type.name === 'link')
  )
    return null;
  const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\ufffc');
  const match = wikiQueryAt(text);
  return match
    ? { ...match, from: selection.from - (text.length - match.from), to: selection.from }
    : null;
}

/** One cancellable lookup per caret query. The editor keeps keyboard focus. */
export function wikiSuggestionPlugin(editor: Editor, getSupport: () => WikiLinkSupport | null) {
  let keyDown: ((event: KeyboardEvent) => boolean) | undefined;
  return new Plugin({
    key: new PluginKey('wikiSuggestions'),
    props: { handleKeyDown: (_view, event) => keyDown?.(event) ?? false },
    view(view) {
      const id = `squisq-wiki-options-${++nextListId}`;
      let list: HTMLDivElement | null = null;
      let current: ReturnType<typeof matchAt> = null;
      let items: WikiLinkSuggestion[] = [];
      let selected = 0;
      let generation = 0;
      let disposed = false;
      let dismissed = '';
      let key = '';
      let support: WikiLinkSupport | null = null;
      const matchKey = (match: NonNullable<typeof current>) =>
        `${match.from}:${match.to}:${match.query}`;
      const hide = () => {
        list?.remove();
        list = null;
        for (const attr of [
          'aria-controls',
          'aria-expanded',
          'aria-activedescendant',
          'aria-autocomplete',
        ])
          view.dom.removeAttribute(attr);
      };
      const position = () => {
        if (!list || !current) return;
        const rect = view.coordsAtPos(current.to);
        const width = list.offsetWidth;
        list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
        const height = list.offsetHeight;
        list.style.top = `${rect.bottom + height + 8 < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)}px`;
      };
      const choose = (index: number) => {
        const item = items[index];
        const match = matchAt(view);
        if (!item || !match || !current || matchKey(match) !== matchKey(current)) return;
        const after = view.state.doc.textBetween(
          match.to,
          Math.min(view.state.doc.content.size, match.to + 2),
        );
        const range = { from: match.from, to: match.to + (after === ']]' ? 2 : 0) };
        hide();
        editor
          .chain()
          .focus()
          .insertContentAt(
            range,
            item.kind === 'folder'
              ? { type: 'text', text: `[[${item.target}` }
              : { type: 'wikiLink', attrs: { target: item.target, label: null } },
          )
          .run();
      };
      const render = () => {
        hide();
        if (!current || !items.length || dismissed === key || disposed) return;
        list = document.createElement('div');
        list.id = id;
        list.className = 'squisq-wiki-suggestions';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', 'Wiki articles and folders');
        items.forEach((item, index) => {
          const option = document.createElement('button');
          option.type = 'button';
          option.tabIndex = -1;
          option.id = `${id}-${index}`;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(index === selected));
          option.textContent = item.label;
          option.title = item.target;
          option.dataset.kind = item.kind;
          option.addEventListener('mousedown', (event) => {
            event.preventDefault();
            choose(index);
          });
          list!.appendChild(option);
        });
        view.dom.ownerDocument.body.appendChild(list);
        view.dom.setAttribute('aria-autocomplete', 'list');
        view.dom.setAttribute('aria-controls', id);
        view.dom.setAttribute('aria-expanded', 'true');
        view.dom.setAttribute('aria-activedescendant', `${id}-${selected}`);
        position();
        list.children[selected]?.scrollIntoView({ block: 'nearest' });
      };
      const update = () => {
        const next = editor.isEditable && view.hasFocus() ? matchAt(view) : null;
        const nextSupport = getSupport();
        const nextKey = next ? matchKey(next) : '';
        if (key === nextKey && support === nextSupport) return;
        key = nextKey;
        support = nextSupport;
        current = next;
        items = [];
        selected = 0;
        const request = ++generation;
        hide();
        if (!next || !nextSupport?.suggest || dismissed === key) return;
        void nextSupport.suggest(next.query).then(
          (candidates) => {
            if (disposed || generation !== request || !view.hasFocus()) return;
            items = validWikiSuggestions(candidates);
            render();
          },
          () => {
            /* A failed optional lookup leaves ordinary typing available. */
          },
        );
      };
      keyDown = (event) => {
        if (!list || !items.length) return false;
        if (event.key === 'Escape') {
          dismissed = key;
          hide();
          return true;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          selected = (selected + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
          render();
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          choose(selected);
          return true;
        }
        return false;
      };
      const blur = () => {
        key = '';
        generation++;
        hide();
      };
      view.dom.addEventListener('blur', blur);
      view.dom.addEventListener('focus', update);
      window.addEventListener('resize', position);
      window.addEventListener('scroll', position, true);
      return {
        update,
        destroy() {
          disposed = true;
          generation++;
          hide();
          keyDown = undefined;
          view.dom.removeEventListener('blur', blur);
          view.dom.removeEventListener('focus', update);
          window.removeEventListener('resize', position);
          window.removeEventListener('scroll', position, true);
        },
      };
    },
  });
}
