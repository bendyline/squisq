/**
 * FillAvailableExtension — a height-capable block at the end of the page takes
 * the room left below it.
 *
 * Widget hosts opt in with the `squisq-block-fill-available` class (the data
 * grid, the diagram canvases, the drawing scene). When such a host ends the
 * document — nothing after it but empty paragraphs — and the page is shorter
 * than its window, this plugin stamps the host with `data-fill-height` and
 * `--squisq-fill-height`: the height from the host's top to the bottom of the
 * visible page, less what must still fit below it. Each component's CSS
 * decides which part grows into that room (the grid's scroller, a diagram's
 * canvas); without the stamp every component keeps its natural height.
 *
 * One measurement serves the document view and the single-block card. The
 * page keeps ordinary block flow: turning the editor into a flex column would
 * stop sibling margins collapsing and respace every paragraph above the block.
 *
 * The target comes from the viewport and from what lies above and below the
 * host, never from the host's own height, so a host growing into it cannot
 * move it; in a container sized by its content it equals the host's natural
 * height. Auto-growing shells (a chat composer) are skipped outright anyway:
 * they have no page edge to fill to.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const FILL_AVAILABLE_CLASS = 'squisq-block-fill-available';
export const FILL_HEIGHT_ATTR = 'data-fill-height';
export const FILL_HEIGHT_VAR = '--squisq-fill-height';

const SCROLL_CONTAINER_SELECTOR = '.squisq-wysiwyg-container';
const AUTO_GROW_SHELL_SELECTOR = '.squisq-editor-shell[data-auto-grow]';

export const FILL_AVAILABLE_KEY = new PluginKey('squisq-fill-available');

function isHidden(el: Element): boolean {
  return getComputedStyle(el).display === 'none';
}

/** An element that puts nothing below a block: a hidden node or an empty paragraph. */
function isBlankTail(el: Element): boolean {
  if (isHidden(el)) return true;
  return (
    el.tagName === 'P' &&
    el.textContent === '' &&
    el.querySelector('img, video, iframe, svg, [contenteditable="false"]') === null
  );
}

/** The fill-capable host that ends the document, if one does. */
export function terminalFillHost(editorDom: HTMLElement): HTMLElement | null {
  for (let el = editorDom.lastElementChild; el; el = el.previousElementSibling) {
    if (el.classList.contains(FILL_AVAILABLE_CLASS)) return el as HTMLElement;
    if (!isBlankTail(el)) return null;
  }
  return null;
}

export interface FillGeometry {
  /** The scroll container's visible height (`clientHeight`). */
  viewportHeight: number;
  /** The host's border-box top, in the container's scroll-content coordinates. */
  hostTop: number;
  /** What must still fit below the host's border box: its margin, any empty tail, the page's bottom padding. */
  below: number;
}

/** The min-height a terminal host may take, or null when the page has no room to give. */
export function fillHeightFor({ viewportHeight, hostTop, below }: FillGeometry): number | null {
  const height = Math.floor(viewportHeight - hostTop - below);
  return height > 0 ? height : null;
}

function px(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function measureFillGeometry(
  container: HTMLElement,
  editorDom: HTMLElement,
  host: HTMLElement,
): FillGeometry {
  const containerRect = container.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const contentTop = containerRect.top + container.clientTop - container.scrollTop;

  let last: Element = host;
  for (let el = editorDom.lastElementChild; el && el !== host; el = el.previousElementSibling) {
    if (!isHidden(el)) {
      last = el;
      break;
    }
  }
  const lastBottom = last.getBoundingClientRect().bottom + px(getComputedStyle(last).marginBottom);
  const editorStyle = getComputedStyle(editorDom);
  const below =
    lastBottom -
    hostRect.bottom +
    px(editorStyle.paddingBottom) +
    px(editorStyle.borderBottomWidth) +
    px(editorStyle.marginBottom) +
    px(getComputedStyle(container).paddingBottom);

  return {
    viewportHeight: container.clientHeight,
    hostTop: hostRect.top - contentTop,
    below,
  };
}

class FillAvailableView {
  private host: HTMLElement | null = null;
  private applied: number | null = null;
  private container: HTMLElement | null = null;
  private frame = 0;
  private readonly observer: ResizeObserver | null;

  constructor(private readonly view: EditorView) {
    this.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            // A viewport resize is answered before paint, so resizing the
            // window never flashes a scrollbar. Anything else waits a frame:
            // re-sizing the host can resize the editor again, and doing that
            // inside this callback trips the browser's ResizeObserver loop
            // guard. The editor is observed for its first layout (Tiptap
            // builds the view before it is attached) and for content above
            // the host that grows without a transaction.
            if (entries.some((entry) => entry.target === this.container)) this.measure();
            else this.schedule();
          });
    this.observer?.observe(view.dom);
    this.schedule();
  }

  update(): void {
    this.measure();
  }

  destroy(): void {
    this.observer?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.release();
  }

  private schedule(): void {
    if (this.frame || typeof requestAnimationFrame === 'undefined') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  private measure(): void {
    const dom = this.view.dom as HTMLElement;
    const container = dom.isConnected ? dom.closest<HTMLElement>(SCROLL_CONTAINER_SELECTOR) : null;
    if (container !== this.container) {
      if (this.container) this.observer?.unobserve(this.container);
      this.container = container;
      if (container) this.observer?.observe(container);
    }
    const host = container && !dom.closest(AUTO_GROW_SHELL_SELECTOR) ? terminalFillHost(dom) : null;
    if (host !== this.host) this.release();
    if (!host || !container) return;
    this.host = host;
    this.apply(host, fillHeightFor(measureFillGeometry(container, dom, host)));
  }

  private apply(host: HTMLElement, height: number | null): void {
    if (height === this.applied) return;
    this.applied = height;
    if (height === null) {
      host.removeAttribute(FILL_HEIGHT_ATTR);
      host.style.removeProperty(FILL_HEIGHT_VAR);
      return;
    }
    host.setAttribute(FILL_HEIGHT_ATTR, String(height));
    host.style.setProperty(FILL_HEIGHT_VAR, `${height}px`);
  }

  private release(): void {
    if (this.host) this.apply(this.host, null);
    this.host = null;
    this.applied = null;
  }
}

export const FillAvailableExtension = Extension.create({
  name: 'squisqFillAvailable',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: FILL_AVAILABLE_KEY,
        view: (view) => new FillAvailableView(view),
      }),
    ];
  },
});

export default FillAvailableExtension;
