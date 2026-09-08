/**
 * DOM measurement for one rendered swatch frame.
 *
 * `BlockRenderer` draws every layer as a `<g class="block-layer
 * block-layer--<kind>">` inside one `<svg viewBox="0 0 W H">`. Text and
 * tables live in `<foreignObject>` boxes whose declared size is an
 * estimate: overflow is left visible on purpose so a mis-estimate never
 * clips a line. That is exactly what a reviewer needs to find, so this
 * module measures the *laid-out* text (a DOM Range over the content) and
 * compares it with the declared box, the frame, and every other text layer.
 *
 * All rectangles are reported in viewport units (the template's coordinate
 * space, e.g. 1920×1080), not the scaled CSS pixels of the capture.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type IssueSeverity = 'high' | 'warn' | 'info';

export interface SwatchIssue {
  kind: string;
  severity: IssueSeverity;
  layerId?: string;
  detail: string;
  /** Magnitude in viewport px where meaningful (overflow distance, font size). */
  px?: number;
}

export interface LayerMetric {
  id: string;
  kind: string;
  /** Declared layer box. */
  box: Rect;
  /** Laid-out text extent (text/table/tree layers). */
  text?: Rect;
  textLength: number;
  fontPx?: number;
  clipped: boolean;
  clamped: boolean;
  visible: boolean;
}

export interface SwatchMetrics {
  layerCount: number;
  textLayerCount: number;
  minFontPx: number | null;
  /** Text visible in the frame, in layer order. */
  renderedText: string;
  /** Fraction of distinctive body words that appear in the rendered text. */
  bodyCoverage: number | null;
  issues: SwatchIssue[];
  layers: LayerMetric[];
}

const CONTENT_KINDS = new Set(['text', 'table', 'tree', 'map', 'mermaid', 'image', 'video']);
const TEXTUAL_KINDS = new Set(['text', 'table', 'tree']);
const EDGE_TOLERANCE_PX = 4;
const OVERLAP_MIN_SIDE_PX = 6;
/** Decorative glyph layers (giant quote marks, ornaments) may sit behind text by design. */
const DECORATIVE_ID = /^deco|decor|ornament|-bg$/i;

function area(r: Rect): number {
  return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
}

function intersect(a: Rect, b: Rect): Rect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function isEmptyRect(r: Rect): boolean {
  return r.right - r.left <= 0 || r.bottom - r.top <= 0;
}

function layerKind(g: Element): string {
  const match = /block-layer--([a-z]+)/.exec(g.getAttribute('class') ?? '');
  return match?.[1] ?? 'unknown';
}

function isHidden(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none';
}

/** Elements that own text directly (not only via descendants). */
function textOwningElements(root: Element): Element[] {
  const owners: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = root;
  while (node) {
    const el = node as Element;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim()) {
        owners.push(el);
        break;
      }
    }
    node = walker.nextNode();
  }
  return owners;
}

function overflowsHiddenBox(el: Element): boolean {
  const style = getComputedStyle(el);
  const hides = /hidden|auto|scroll|clip/.test(`${style.overflowX} ${style.overflowY}`);
  if (!hides) return false;
  const h = el as HTMLElement;
  return h.scrollHeight > h.clientHeight + 2 || h.scrollWidth > h.clientWidth + 2;
}

function hasLineClamp(el: Element): boolean {
  const style = getComputedStyle(el) as CSSStyleDeclaration & { webkitLineClamp?: string };
  const clamp = style.webkitLineClamp ?? style.getPropertyValue('-webkit-line-clamp');
  return Boolean(clamp) && clamp !== 'none' && clamp !== '';
}

/** Distinctive words (4+ chars, letters/digits) used for body-coverage. */
export function coverageWords(text: string): string[] {
  const words = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 4) words.add(raw);
  }
  return Array.from(words);
}

export function measureFrame(
  frame: HTMLElement,
  viewport: { width: number; height: number },
  bodyWords: readonly string[],
): SwatchMetrics {
  const frameRect = frame.getBoundingClientRect();
  const scale = frameRect.width / viewport.width || 1;
  const toVp = (r: DOMRect): Rect => ({
    left: (r.left - frameRect.left) / scale,
    top: (r.top - frameRect.top) / scale,
    right: (r.right - frameRect.left) / scale,
    bottom: (r.bottom - frameRect.top) / scale,
  });

  const groups = Array.from(frame.querySelectorAll<SVGGElement>('g.block-layer')).filter(
    (g) => !g.parentElement?.closest('g.block-layer'),
  );

  const layers: LayerMetric[] = [];
  const issues: SwatchIssue[] = [];
  const renderedChunks: string[] = [];

  groups.forEach((g, index) => {
    const kind = layerKind(g);
    const id = g.getAttribute('data-layer-id') ?? `${kind}-${index}`;
    const fo = g.querySelector('foreignObject');
    let box = toVp(g.getBoundingClientRect());
    let text: Rect | undefined;
    let textLength = 0;
    let fontPx: number | undefined;
    let clipped = false;
    let clamped = false;
    let visible = !isHidden(g);

    if (TEXTUAL_KINDS.has(kind)) {
      const contentRoot: Element | null = fo
        ? (fo.querySelector('[data-squisq-text-content]') ??
          fo.querySelector('table') ??
          fo.firstElementChild)
        : g;
      if (fo) box = toVp(fo.getBoundingClientRect());
      if (contentRoot) {
        if (visible && isHidden(contentRoot)) visible = false;
        const content = (contentRoot.textContent ?? '').replace(/\s+/g, ' ').trim();
        textLength = content.length;
        if (textLength > 0) {
          renderedChunks.push(content);
          const range = document.createRange();
          range.selectNodeContents(contentRoot);
          const rangeRect = range.getBoundingClientRect();
          range.detach();
          text = isEmptyRect(toVp(rangeRect))
            ? toVp(contentRoot.getBoundingClientRect())
            : toVp(rangeRect);
          if (kind === 'text' || kind === 'tree') {
            const sizes = textOwningElements(contentRoot).map(
              (el) => parseFloat(getComputedStyle(el).fontSize) / scale,
            );
            if (sizes.length > 0) fontPx = Math.min(...sizes);
          }
        }
        // Walk the foreignObject subtree for hidden-overflow containers and clamps.
        const candidates: Element[] = fo
          ? [
              fo.firstElementChild,
              contentRoot,
              ...Array.from(fo.querySelectorAll('[data-squisq-table-scroll]')),
            ].filter((el): el is Element => Boolean(el))
          : [];
        clipped = candidates.some(overflowsHiddenBox);
        clamped = [contentRoot, ...Array.from(contentRoot.children)].some(hasLineClamp);
      }
    }

    layers.push({ id, kind, box, text, textLength, fontPx, clipped, clamped, visible });
  });

  const W = viewport.width;
  const H = viewport.height;

  // Out-of-frame content and decoration.
  for (const layer of layers) {
    if (!layer.visible) continue;
    const rect = layer.text ?? layer.box;
    if (isEmptyRect(rect)) continue;
    if (TEXTUAL_KINDS.has(layer.kind) && layer.textLength === 0) continue;
    const overs: Array<[string, number]> = [
      ['left', -rect.left],
      ['top', -rect.top],
      ['right', rect.right - W],
      ['bottom', rect.bottom - H],
    ];
    const [side, amount] = overs.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (amount <= EDGE_TOLERANCE_PX) continue;
    const contentKind =
      TEXTUAL_KINDS.has(layer.kind) || layer.kind === 'map' || layer.kind === 'mermaid';
    const decorative = DECORATIVE_ID.test(layer.id);
    issues.push({
      kind: contentKind && !decorative ? 'out-of-frame' : 'decor-out-of-frame',
      severity: contentKind && !decorative ? 'high' : 'info',
      layerId: layer.id,
      detail: `${layer.kind} "${layer.id}" runs ${Math.round(amount)}px past the ${side} edge`,
      px: Math.round(amount),
    });
  }

  // Text-on-text collisions.
  const textual = layers.filter(
    (l) =>
      l.visible && TEXTUAL_KINDS.has(l.kind) && l.textLength > 0 && l.text && !isEmptyRect(l.text),
  );
  for (let i = 0; i < textual.length; i += 1) {
    for (let j = i + 1; j < textual.length; j += 1) {
      const a = textual[i];
      const b = textual[j];
      const inter = intersect(a.text!, b.text!);
      const iw = inter.right - inter.left;
      const ih = inter.bottom - inter.top;
      if (iw < OVERLAP_MIN_SIDE_PX || ih < OVERLAP_MIN_SIDE_PX) continue;
      const ratio = area(inter) / Math.max(1, Math.min(area(a.text!), area(b.text!)));
      if (ratio < 0.08) continue;
      const decorative = DECORATIVE_ID.test(a.id) || DECORATIVE_ID.test(b.id);
      issues.push({
        kind: 'text-overlap',
        severity: decorative ? 'warn' : ratio >= 0.25 ? 'high' : 'warn',
        layerId: a.id,
        detail: `"${a.id}" overlaps "${b.id}" (${Math.round(ratio * 100)}% of the smaller box, ${Math.round(iw)}×${Math.round(ih)}px)`,
        px: Math.round(Math.min(iw, ih)),
      });
    }
  }

  // Clipped / clamped text.
  for (const layer of layers) {
    if (!layer.visible || layer.textLength === 0) continue;
    if (layer.clipped) {
      const tableScroll = layer.kind === 'table';
      issues.push({
        kind: tableScroll ? 'table-scroll-clipped' : 'text-clipped',
        severity: tableScroll ? 'warn' : 'high',
        layerId: layer.id,
        detail: tableScroll
          ? `table "${layer.id}" is taller than its scroll box; rows are hidden in a static capture`
          : `text "${layer.id}" overflows a hidden-overflow box`,
      });
    }
    if (layer.clamped) {
      issues.push({
        kind: 'text-clamped',
        severity: 'info',
        layerId: layer.id,
        detail: `text "${layer.id}" is line-clamped (maxLines); tail may be truncated`,
      });
    }
  }

  // Tiny type.
  const fontSizes = layers
    .filter((l) => l.visible && l.textLength > 0 && typeof l.fontPx === 'number')
    .map((l) => l.fontPx as number);
  const minFontPx = fontSizes.length > 0 ? Math.min(...fontSizes) : null;
  if (minFontPx !== null && minFontPx < 18) {
    const smallest = layers.find((l) => l.fontPx === minFontPx);
    issues.push({
      kind: 'tiny-text',
      severity: minFontPx < 14 ? 'warn' : 'info',
      layerId: smallest?.id,
      detail: `smallest text is ${minFontPx.toFixed(1)}px at ${W}×${H} ("${smallest?.id}")`,
      px: Math.round(minFontPx),
    });
  }

  // Fallback card.
  const notice = layers.find((l) => l.id === 'fallback-notice');
  if (notice) {
    const noticeText =
      renderedChunks.find((c) => /template|fallback|unknown|failed/i.test(c)) ?? '';
    issues.push({
      kind: 'fallback',
      severity: 'high',
      layerId: notice.id,
      detail: noticeText ? `fallback card: ${noticeText}` : 'fallback card rendered',
    });
  }

  // Nothing to look at.
  const hasContent = layers.some(
    (l) =>
      l.visible && CONTENT_KINDS.has(l.kind) && (!TEXTUAL_KINDS.has(l.kind) || l.textLength > 0),
  );
  if (!hasContent) {
    issues.push({ kind: 'empty-frame', severity: 'high', detail: 'no visible content layers' });
  }

  const renderedText = renderedChunks.join(' ');
  let bodyCoverage: number | null = null;
  if (bodyWords.length > 0) {
    const haystack = renderedText.toLowerCase();
    const hits = bodyWords.filter((w) => haystack.includes(w)).length;
    bodyCoverage = hits / bodyWords.length;
  }

  return {
    layerCount: layers.length,
    textLayerCount: layers.filter((l) => l.kind === 'text').length,
    minFontPx,
    renderedText,
    bodyCoverage,
    issues,
    layers,
  };
}
