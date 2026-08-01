/**
 * HostFenceWidget — the React surface `HostFenceExtension` mounts after a
 * claimed code fence, and the sibling of `AsciiDiagramWidget` /
 * `TreeOutlineWidget` / `CodeSnippetWidget`.
 *
 * The fence body is the single source of truth: the widget re-reads the node
 * on every editor transaction, hands the host renderer `mode: 'edit'` plus a
 * `replaceValue` callback, and falls back to a plain code block when no
 * renderer claims the language or the renderer throws. A host renderer is
 * arbitrary third-party code, so an error boundary keeps one bad fence from
 * taking down the editor.
 */

import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { Theme } from '@bendyline/squisq/schemas';
import type { FenceRendererMap } from '@bendyline/squisq/fence';
import { fenceLangToken, findHostFenceBlockPos, replaceHostFenceText } from './HostFenceExtension';

class HostFenceErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface HostFenceWidgetProps {
  editor: Editor;
  blockId: string;
  getRenderers: () => FenceRendererMap | null | undefined;
  getTheme: () => Theme | undefined;
}

export function HostFenceWidget({ editor, blockId, getRenderers, getTheme }: HostFenceWidgetProps) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  const current = useMemo(() => {
    const pos = findHostFenceBlockPos(editor, blockId);
    if (pos === null) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'codeBlock') return null;
    return { lang: fenceLangToken(node), value: node.textContent };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, blockId, version]);

  if (!current) return null;
  const renderer = getRenderers()?.[current.lang];
  const rawFallback = (
    <pre className="squisq-md-code-block">
      <code>{current.value}</code>
    </pre>
  );
  if (!renderer) return rawFallback;

  const theme = getTheme();
  return (
    <HostFenceErrorBoundary fallback={rawFallback}>
      {
        renderer({
          lang: current.lang,
          value: current.value,
          ...(theme ? { theme } : {}),
          mode: 'edit',
          replaceValue: (next: string) => {
            replaceHostFenceText(editor, blockId, next);
          },
        }) as ReactNode
      }
    </HostFenceErrorBoundary>
  );
}
