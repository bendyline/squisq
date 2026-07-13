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
