import { Node, InputRule } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { wikiLinkPath } from '@bendyline/squisq/markdown';
import { useEditorContext } from './EditorContext';

function WikiLinkView({ node, editor }: NodeViewProps) {
  const { wikiLinks } = useEditorContext();
  const target = String(node.attrs.target ?? '');
  const [exists, setExists] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setExists(null);
    setError('');
    if (wikiLinks && wikiLinkPath(target)) {
      void (wikiLinks.resolve ? wikiLinks.resolve(target) : wikiLinks.exists(target)).then(
        (found) => {
          if (!cancelled) setExists(Boolean(found));
        },
        (reason: unknown) => {
          if (!cancelled)
            setError(reason instanceof Error ? reason.message : 'Could not check article');
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [wikiLinks, target]);
  const action = exists === false ? 'Create article' : 'Open article';
  const open = async () => {
    if (!wikiLinks || busy || exists === null) return;
    setBusy(true);
    setError('');
    try {
      await wikiLinks.open(target, { create: editor.isEditable });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Could not open article');
    } finally {
      setBusy(false);
    }
  };
  return (
    <NodeViewWrapper as="span" className="squisq-wiki-link" contentEditable={false}>
      {wikiLinks ? (
        <button
          type="button"
          data-wiki-missing={exists === false || undefined}
          title={error || `${action}: ${target}`}
          aria-label={`${action}: ${target}`}
          disabled={busy || exists === null || (!editor.isEditable && !exists)}
          onClick={() => void open()}
        >
          {target}
        </button>
      ) : (
        target
      )}
      {error && (
        <span role="alert" className="squisq-wiki-error">
          {' '}
          {error}
        </span>
      )}
    </NodeViewWrapper>
  );
}

/** Atomic inline node: the source remains [[target]] through every edit. */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-wiki-link'),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-wiki-link': attrs.target }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-wiki-link]',
        getAttrs: (element: HTMLElement) =>
          wikiLinkPath(element.getAttribute('data-wiki-link') ?? '') ? null : false,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', HTMLAttributes, String(node.attrs.target)];
  },
  renderText({ node }) {
    return `[[${String(node.attrs.target)}]]`;
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^[\]\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          if (!wikiLinkPath(match[1])) return null;
          const before = state.doc.textBetween(Math.max(0, range.from - 1), range.from);
          if (before === '\\') return null;
          state.tr.replaceWith(range.from, range.to, this.type.create({ target: match[1] }));
        },
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView);
  },
});
