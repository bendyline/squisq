/**
 * Hooks a fence widget's Monaco inset uses: the host's color scheme (and
 * whether the host is still attached), and the editor's editability.
 */

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';

function schemeFromHost(host: HTMLElement | null | undefined): 'light' | 'dark' {
  return host?.closest<HTMLElement>('[data-theme]')?.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Resolve the color scheme from the widget's host element, or `null` when the
 * host is detached from the document.
 *
 * `null` matters because Monaco's theme is page-global: every mounted
 * `<MonacoEditor>` re-applies its own `theme` prop to every editor on the
 * page. ProseMirror can rebuild widget decorations during a view-mode switch,
 * producing a widget whose DOM is torn down again within milliseconds — but
 * whose React root still renders once. By then the host tree is detached, so
 * `closest('[data-theme]')` finds nothing and the scheme would fall back to
 * `'light'`, restyling the Source editor that just mounted dark. A `null`
 * scheme tells the widget to keep its placeholder and never mount Monaco.
 *
 * A host that was merely rendered a frame before its editor view attached
 * flips to a real scheme on the follow-up check; a teardown zombie never
 * does. A missing host (`undefined`/`null`) keeps the historical light
 * default so host-less mounts still render.
 */
export function useHostColorScheme(host: HTMLElement | null | undefined): 'light' | 'dark' | null {
  const [scheme, setScheme] = useState<'light' | 'dark' | null>(() =>
    host != null && !host.isConnected ? null : schemeFromHost(host),
  );
  useEffect(() => {
    if (host != null && !host.isConnected) {
      setScheme(null);
      const raf = requestAnimationFrame(() => {
        if (host.isConnected) setScheme(schemeFromHost(host));
      });
      return () => cancelAnimationFrame(raf);
    }
    const themedAncestor = host?.closest<HTMLElement>('[data-theme]');
    setScheme(schemeFromHost(host));
    if (!themedAncestor || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setScheme(schemeFromHost(host)));
    observer.observe(themedAncestor, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [host]);
  return scheme;
}

/** Whether the editor currently accepts edits, kept in sync with it. */
export function useEditorEditable(editor: Editor): boolean {
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    editor.on('update', sync);
    editor.on('transaction', sync);
    return () => {
      editor.off('update', sync);
      editor.off('transaction', sync);
    };
  }, [editor]);
  return editable;
}
