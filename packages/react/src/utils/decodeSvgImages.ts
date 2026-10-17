/**
 * Wait for the pictures an SVG `<image>` shows to decode.
 *
 * Capture readiness checks have always awaited HTML `<img>` elements; an SVG
 * `<image>` — an SVG island on a slide, an image layer in contain/fill mode —
 * has no `decode()` of its own. Decoding the same URL through a detached
 * `Image` warms the cache the `<image>` paints from. Only `data:` and `blob:`
 * URLs are decoded, so this never starts a network request.
 */
export async function decodeSvgImages(root: ParentNode): Promise<void> {
  if (typeof Image === 'undefined') return;
  const hrefs = new Set<string>();
  for (const element of Array.from(root.querySelectorAll('svg image'))) {
    const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
    if (href && /^(?:data|blob):/i.test(href)) hrefs.add(href);
  }
  await Promise.allSettled(
    [...hrefs].map((href) => {
      const image = new Image();
      image.src = href;
      return typeof image.decode === 'function'
        ? image.decode().catch(() => undefined)
        : Promise.resolve();
    }),
  );
}
