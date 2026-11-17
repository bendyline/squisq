/**
 * Scroll-position handoff between the WYSIWYG and source editors.
 *
 * The two surfaces render the same document at very different heights, so a
 * normalized position is a better shared currency than raw pixels. Keeping
 * these adapters separate from EditorContext also makes the DOM/Monaco math
 * independently testable.
 */

interface MonacoScrollEditor {
  getScrollTop(): number;
  getScrollHeight(): number;
  getLayoutInfo(): { height: number };
  setScrollTop(scrollTop: number): void;
}

interface WysiwygScrollEditor {
  view: { dom: Element };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scrollRatio(
  scrollTop: number,
  scrollHeight: number,
  viewportHeight: number,
): number {
  const availableScroll = scrollHeight - viewportHeight;
  if (availableScroll <= 0) return 0;
  return clampRatio(scrollTop / availableScroll);
}

export function scrollTopForRatio(
  ratio: number,
  scrollHeight: number,
  viewportHeight: number,
): number {
  return clampRatio(ratio) * Math.max(0, scrollHeight - viewportHeight);
}

export function readMonacoScrollRatio(editor: MonacoScrollEditor): number {
  return scrollRatio(
    editor.getScrollTop(),
    editor.getScrollHeight(),
    editor.getLayoutInfo().height,
  );
}

export function restoreMonacoScrollRatio(editor: MonacoScrollEditor, ratio: number): void {
  editor.setScrollTop(
    scrollTopForRatio(ratio, editor.getScrollHeight(), editor.getLayoutInfo().height),
  );
}

interface Disposable {
  dispose(): void;
}

interface MonacoSettlingEditor {
  onDidLayoutChange?(listener: () => void): Disposable;
  onDidContentSizeChange?(listener: () => void): Disposable;
  getDomNode?(): HTMLElement | null;
}

/** Input that means the user has taken over the editor's scroll and caret. */
const USER_TAKEOVER_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Apply a scroll position to a freshly mounted Monaco editor, and again each
 * time its layout or wrapped height changes, until the user takes over or
 * `settleMs` passes. Returns a function that stops early.
 *
 * Monaco mounts at a placeholder size (a few pixels wide, zero tall) and wraps
 * every line for it before its first real layout. A position computed then is
 * measured against that tall placeholder document, and once the real layout
 * arrives the scroll clamps to the end of the file.
 *
 * The events are feature-detected: an editor without them (a test double, an
 * older Monaco) gets the single application.
 */
export function applyAsMonacoLayoutSettles(
  editor: MonacoSettlingEditor,
  apply: () => void,
  settleMs = 1500,
): () => void {
  apply();
  if (
    typeof editor.onDidLayoutChange !== 'function' ||
    typeof editor.onDidContentSizeChange !== 'function'
  ) {
    return () => undefined;
  }
  const subscriptions = [editor.onDidLayoutChange(apply), editor.onDidContentSizeChange(apply)];
  const node = typeof editor.getDomNode === 'function' ? editor.getDomNode() : null;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    for (const subscription of subscriptions) subscription.dispose();
    for (const type of USER_TAKEOVER_EVENTS) node?.removeEventListener(type, stop, true);
  };
  for (const type of USER_TAKEOVER_EVENTS) {
    node?.addEventListener(type, stop, { capture: true, passive: true });
  }
  const timer = setTimeout(stop, settleMs);
  return stop;
}

function findWysiwygScrollElement(editor: WysiwygScrollEditor): HTMLElement | null {
  return editor.view.dom.closest<HTMLElement>('.squisq-wysiwyg-container');
}

export function readWysiwygScrollRatio(editor: WysiwygScrollEditor): number | null {
  const element = findWysiwygScrollElement(editor);
  if (!element) return null;
  return scrollRatio(element.scrollTop, element.scrollHeight, element.clientHeight);
}

export function restoreWysiwygScrollRatio(editor: WysiwygScrollEditor, ratio: number): boolean {
  const element = findWysiwygScrollElement(editor);
  if (!element) return false;
  element.scrollTop = scrollTopForRatio(ratio, element.scrollHeight, element.clientHeight);
  return true;
}
