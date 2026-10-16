/**
 * Mounting for the React widgets the editor embeds in ProseMirror widget
 * decorations (diagrams, scenes, trees, timelines, data cards, code snippets,
 * host fences). Each is its own React root, so two things the main tree gets
 * for free have to be supplied here:
 *
 * - An error boundary. A widget that throws while rendering has no ancestor to
 *   catch it: its root unmounts, the error reaches `window.onerror`, and the
 *   block silently vanishes from the editor. The boundary keeps the failure
 *   inside the block and says so, and the Markdown is never touched.
 *
 * - A deferred first render. ProseMirror builds widget DOM synchronously,
 *   including while React is rendering the editor itself (Tiptap creates its
 *   view during render). Rendering another root from inside a render is a
 *   nested update React warns about and cannot commit then anyway; a
 *   microtask lands after that render and still before paint.
 *
 * Unmounting is deferred for the mirror-image reason: ProseMirror destroys
 * widgets mid-update, and React refuses to unmount a root synchronously while
 * any root is rendering.
 */

import { Component, createElement, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/** The handle an extension keeps to tear its widget down. */
export interface WidgetRoot {
  unmount(): void;
}

interface WidgetErrorBoundaryProps {
  /** What the widget is, for the fallback: "diagram", "drawing", … */
  label: string;
  children?: ReactNode;
}

interface WidgetErrorBoundaryState {
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  state: WidgetErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[squisq-editor] The ${this.props.label} widget failed to render:`,
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return createElement(
      'div',
      { className: 'squisq-widget-error', role: 'note' },
      `This ${this.props.label} can't be displayed here. Its Markdown is unchanged; edit it in Source view.`,
    );
  }
}

/**
 * Render `element` into `container` as an isolated widget root. Returns the
 * handle whose `unmount` the decoration's `destroy` should call.
 */
export function mountWidgetRoot(
  container: HTMLElement,
  label: string,
  element: ReactElement,
): WidgetRoot {
  const root = createRoot(container);
  let unmounted = false;
  queueMicrotask(() => {
    if (!unmounted) root.render(createElement(WidgetErrorBoundary, { label }, element));
  });
  return {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      setTimeout(() => root.unmount(), 0);
    },
  };
}
