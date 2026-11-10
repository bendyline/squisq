/** @vitest-environment jsdom */

/**
 * The hover title of a delegated link, against a real ProseMirror view.
 *
 * The regression this pins: the title used to be written on the link itself.
 * ProseMirror redraws a range when an attribute changes on anything it
 * rendered, and under a link carrying a proofing squiggle that redraw replaced
 * the element the pointer was on — repeatedly, since each replacement was
 * "entered" in turn — so no element lived from press to release and the click
 * that opens the link never fired.
 */

import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLinkHoverTitle,
  clearStaleLinkHoverTitle,
  showLinkHoverTitle,
} from '../linkHoverTitle';
import { ProofingExtension, updateTiptapProofingDecorations } from '../proofing/ProofingExtension';

const HREF = 'https://example.com/the';

let editor: Editor | null = null;

/** An editor holding one link whose whole text is squiggled. */
function mountSquiggledLink(): { root: HTMLElement; anchor: HTMLElement; squiggle: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  editor = new Editor({
    element: host,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: false }),
      ProofingExtension,
    ],
    content: `<p>See <a href="${HREF}">teh</a> page.</p>`,
  });
  // "See " is positions 1–4, so the link's text occupies 5–8.
  updateTiptapProofingDecorations(editor, [
    { findingId: 'f1', from: 5, to: 8, category: 'spelling' },
  ]);
  const root = editor.view.dom as HTMLElement;
  const anchor = root.querySelector<HTMLElement>('a[href]');
  const squiggle = root.querySelector<HTMLElement>('[data-proof-id="f1"]');
  if (!anchor || !squiggle) throw new Error('the squiggled link did not render');
  expect(squiggle.textContent).toBe('teh');
  expect(squiggle.closest('a[href]')).toBe(anchor);
  return { root, anchor, squiggle };
}

/** Let ProseMirror's mutation observer run and redraw whatever it marked dirty. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

describe('inside a ProseMirror editor', () => {
  it('shows the href from the editor root and leaves the link as rendered', async () => {
    const { root, anchor, squiggle } = mountSquiggledLink();

    showLinkHoverTitle(anchor);
    await settle();

    expect(root.getAttribute('title')).toBe(HREF);
    expect(anchor.hasAttribute('title')).toBe(false);
    // The element the pointer is on is still the one in the document.
    expect(squiggle.isConnected).toBe(true);
    expect(root.querySelector('[data-proof-id="f1"]')).toBe(squiggle);

    clearLinkHoverTitle(anchor);
    await settle();
    expect(root.hasAttribute('title')).toBe(false);
    expect(squiggle.isConnected).toBe(true);
  });

  it('would lose the squiggle element if the title were written on the link', async () => {
    // Why the root carries the title. If this stops holding, ProseMirror no
    // longer redraws on a foreign attribute and the indirection can go.
    const { anchor, squiggle } = mountSquiggledLink();
    anchor.setAttribute('title', HREF);
    await settle();
    expect(squiggle.isConnected).toBe(false);
  });

  it('leaves an authored link title to show on its own', async () => {
    const { root, anchor } = mountSquiggledLink();
    anchor.setAttribute('title', 'Read the documentation');
    showLinkHoverTitle(anchor);
    expect(root.hasAttribute('title')).toBe(false);
    expect(anchor.getAttribute('title')).toBe('Read the documentation');
  });

  it('never replaces a title the host put on the editor', () => {
    const { root, anchor } = mountSquiggledLink();
    root.setAttribute('title', 'Document body');
    showLinkHoverTitle(anchor);
    clearLinkHoverTitle(anchor);
    expect(root.getAttribute('title')).toBe('Document body');
  });

  it('takes down a title whose link vanished under the pointer', () => {
    const { root, anchor } = mountSquiggledLink();
    showLinkHoverTitle(anchor);
    const paragraph = root.querySelector('p') as HTMLElement;
    // The pointer is now over plain text; no mouseout ever named the link.
    clearStaleLinkHoverTitle(paragraph);
    expect(root.hasAttribute('title')).toBe(false);
  });
});

describe('outside an editor', () => {
  it('writes the title on the link itself', () => {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', HREF);
    document.body.append(anchor);

    showLinkHoverTitle(anchor);
    expect(anchor.getAttribute('title')).toBe(HREF);

    clearLinkHoverTitle(anchor);
    expect(anchor.hasAttribute('title')).toBe(false);
  });
});
