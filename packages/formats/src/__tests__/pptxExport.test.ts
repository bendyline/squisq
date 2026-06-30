import { describe, expect, it } from 'vitest';
import type { MarkdownBlockNode, MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Transition } from '@bendyline/squisq/schemas';
import { TRANSITION_TYPES } from '@bendyline/squisq/schemas';
import { markdownDocToPptx } from '../pptx/export';
import { openPackage, getPartXml } from '../ooxml/reader';
import { NS_PML, NS_PML_2010 } from '../ooxml/namespaces';

function docWithSecondSlideTransition(transition: Transition): MarkdownDocument {
  return {
    type: 'document',
    children: [
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'One' }],
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Intro' }],
      },
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'Two' }],
        attributes: {
          params: {
            transition: transition.type,
            ...(transition.duration !== undefined
              ? { transitionDuration: String(transition.duration) }
              : {}),
            ...(transition.direction ? { transitionDirection: transition.direction } : {}),
          },
          blockMeta: { transition },
        },
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Body' }],
      },
    ],
  };
}

function docWithAllTransitions(): MarkdownDocument {
  const children: MarkdownBlockNode[] = [
    {
      type: 'heading',
      depth: 2,
      children: [{ type: 'text', value: 'Transition Gallery' }],
    },
    {
      type: 'paragraph',
      children: [{ type: 'text', value: 'Intro slide before transition checks.' }],
    },
  ];

  for (const type of TRANSITION_TYPES) {
    const transition: Transition = { type, duration: 0.8 };
    children.push(
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: type }],
        attributes: {
          params: { transition: type, transitionDuration: '0.8' },
          blockMeta: { transition },
        },
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: `Transition token: ${type}` }],
      },
    );
  }

  return { type: 'document', children };
}

describe('markdownDocToPptx transitions', () => {
  it('writes valid transition XML for every shared transition token', async () => {
    const pkg = await openPackage(await markdownDocToPptx(docWithAllTransitions()));

    for (let i = 0; i < TRANSITION_TYPES.length; i++) {
      const type = TRANSITION_TYPES[i];
      const slide = await getPartXml(pkg, `ppt/slides/slide${i + 2}.xml`);
      expect(slide, type).not.toBeNull();

      const transitions = slide!.getElementsByTagNameNS(NS_PML, 'transition');
      if (type === 'cut') {
        expect(transitions, type).toHaveLength(0);
        continue;
      }

      expect(transitions, type).toHaveLength(1);
      expect(transitions[0].getAttribute('spd'), type).toBe('med');

      const childElements = Array.from(transitions[0].childNodes).filter(
        (node): node is Element => node.nodeType === 1,
      );
      expect(childElements, type).toHaveLength(1);
      expect([NS_PML, NS_PML_2010], type).toContain(childElements[0].namespaceURI);

      if (childElements[0].namespaceURI === NS_PML_2010) {
        expect(slide!.documentElement.getAttribute('mc:Ignorable'), type).toContain('p14');
      }
    }
  });

  it('writes standard PresentationML transition XML', async () => {
    const md = docWithSecondSlideTransition({
      type: 'checkerboard',
      duration: 1.3,
      direction: 'vertical',
    });

    const pkg = await openPackage(await markdownDocToPptx(md));
    const slide = await getPartXml(pkg, 'ppt/slides/slide2.xml');
    const transition = slide!.getElementsByTagNameNS(NS_PML, 'transition')[0];
    const checker = transition.getElementsByTagNameNS(NS_PML, 'checker')[0];

    expect(transition.getAttribute('spd')).toBe('slow');
    expect(checker.getAttribute('dir')).toBe('vert');
  });

  it('writes PowerPoint 2010 transition XML when needed', async () => {
    const md = docWithSecondSlideTransition({ type: 'flash', duration: 0.4 });

    const pkg = await openPackage(await markdownDocToPptx(md));
    const slide = await getPartXml(pkg, 'ppt/slides/slide2.xml');
    const transition = slide!.getElementsByTagNameNS(NS_PML, 'transition')[0];
    const flash = transition.getElementsByTagNameNS(NS_PML_2010, 'flash')[0];

    expect(transition.getAttribute('spd')).toBe('fast');
    expect(flash).toBeDefined();
    expect(slide!.documentElement.getAttribute('mc:Ignorable')).toBe('p14');
  });
});
