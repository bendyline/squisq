/** CSS hook used by both the editor behavior and its presentation layer. */
export const ACCESSORY_FILE_LINK_CLASS = 'squisq-attachment-link';

/**
 * Present links whose authored href names a file in the active accessory bin
 * as compact attachment placeholders. This is deliberately DOM-only: the
 * ProseMirror document keeps an ordinary link mark, so Markdown round-trips
 * unchanged as `[label](relative/path)`.
 */
export function syncAccessoryFileLinkPlaceholders(
  root: ParentNode,
  accessoryPaths: ReadonlySet<string>,
): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    link.classList.toggle(ACCESSORY_FILE_LINK_CLASS, accessoryPaths.has(href));
  }
}
