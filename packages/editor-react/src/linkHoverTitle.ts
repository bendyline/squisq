/**
 * The hover title of a host-delegated link: while the pointer is over a link
 * the host opens, its href shows as a native tooltip.
 */

/** Marks a `title` this module wrote, as opposed to one an author or host set. */
const OWNED = 'data-squisq-link-title';

/**
 * The element that carries a link's hover title.
 *
 * Inside a ProseMirror editor that is the editor's root, never the link.
 * ProseMirror treats an attribute changing on anything it rendered as a foreign
 * edit and redraws that range. Under a link whose text also carries an inline
 * decoration (a proofing squiggle), the redraw replaces the element the pointer
 * is on; the browser then reports the pointer entering the replacement, which
 * wrote the title again, and the loop left no element alive from press to
 * release — so the click that opens the link never fired. The root is the one
 * element whose attributes ProseMirror does not watch, and a title there shows
 * for everything beneath it.
 */
function titleHost(anchor: Element): Element {
  return anchor.closest('.ProseMirror') ?? anchor;
}

function clear(host: Element): void {
  host.removeAttribute('title');
  host.removeAttribute(OWNED);
}

/** Show `anchor`'s href as its hover title, unless a title is already there. */
export function showLinkHoverTitle(anchor: Element): void {
  const href = anchor.getAttribute('href');
  if (!href) return;
  const host = titleHost(anchor);
  // An authored title on the link itself shows natively and stays the author's.
  if (host !== anchor && anchor.hasAttribute('title')) return;
  if (host.hasAttribute('title')) {
    if (!host.hasAttribute(OWNED) || host.getAttribute('title') === href) return;
  }
  host.setAttribute('title', href);
  host.setAttribute(OWNED, 'true');
}

/** Take down the hover title shown for `anchor`. */
export function clearLinkHoverTitle(anchor: Element): void {
  const host = titleHost(anchor);
  if (host.hasAttribute(OWNED)) clear(host);
}

/**
 * Take down a title left on the editor around `target`. A link can vanish
 * under the pointer (an edit, a redraw) with no `mouseout` to say so, and its
 * href would otherwise keep showing over ordinary text.
 */
export function clearStaleLinkHoverTitle(target: Element): void {
  const host = target.closest?.(`.ProseMirror[${OWNED}]`);
  if (host) clear(host);
}
