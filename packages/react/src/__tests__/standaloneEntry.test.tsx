import { afterEach, describe, expect, it } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';
import { getHandle, mount, unmount } from '../standalone-entry';
import * as standalone from '../standalone-entry';

function doc(id: string): Doc {
  return {
    articleId: id,
    duration: 2,
    blocks: [{ id: `${id}-block`, startTime: 0, duration: 2, audioSegment: 0, layers: [] }],
    audio: { segments: [] },
  };
}

function animatedDoc(id: string): Doc {
  const result = doc(id);
  result.blocks[0].layers = [
    {
      type: 'text',
      id: `${id}-title`,
      content: { text: 'Standalone motion', style: { fontSize: 48, color: '#fff' } },
      position: { x: 100, y: 100 },
      animation: { type: 'fadeIn', duration: 1 },
    },
  ];
  return result;
}

const mountedElements: Element[] = [];

afterEach(() => {
  for (const element of mountedElements.splice(0)) unmount(element);
});

describe('standalone player instance handles', () => {
  it('does not expose the removed mountStatic compatibility alias', () => {
    expect('mountStatic' in standalone).toBe(false);
  });

  it('returns the render API for exactly the mounted player instance', async () => {
    const firstRoot = document.createElement('div');
    const secondRoot = document.createElement('div');
    document.body.append(firstRoot, secondRoot);
    mountedElements.push(firstRoot, secondRoot);

    const first = mount(firstRoot, doc('first'), { renderMode: true });
    const second = mount(secondRoot, doc('second'), { renderMode: true });
    const [firstAPI, secondAPI] = await Promise.all([first.renderAPI, second.renderAPI]);

    expect(firstAPI?.getBlocks()[0].id).toBe('first-block');
    expect(secondAPI?.getBlocks()[0].id).toBe('second-block');
    expect(getHandle(firstRoot)).toBe(first);
    expect(getHandle(secondRoot)).toBe(second);
    expect('seekTo' in window).toBe(false);
    expect('getDuration' in window).toBe(false);
    expect('squisqActivePlayerId' in window).toBe(false);
    expect('squisqPlayers' in window).toBe(false);
  });

  it('resolves a null render API outside render mode and owns unmounting', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountedElements.push(root);

    const handle = mount(root, doc('static'), { mode: 'static' });
    expect(await handle.renderAPI).toBeNull();
    expect(getHandle(root)).toBe(handle);

    handle.unmount();
    expect(getHandle(root)).toBeUndefined();
  });

  it('prevents a stale handle from unmounting a newer player in the same element', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountedElements.push(root);

    const first = mount(root, doc('first'), { renderMode: true });
    expect((await first.renderAPI)?.getBlocks()[0].id).toBe('first-block');

    const second = mount(root, doc('second'), { renderMode: true });
    expect((await second.renderAPI)?.getBlocks()[0].id).toBe('second-block');
    expect(first.getRenderAPI()).toBeNull();

    first.unmount();
    expect(getHandle(root)).toBe(second);
    expect(second.getRenderAPI()?.getBlocks()[0].id).toBe('second-block');
  });

  it('forwards the animationsEnabled render policy to the mounted player', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountedElements.push(root);

    const handle = mount(root, animatedDoc('motionless'), {
      renderMode: true,
      animationsEnabled: false,
    });
    await handle.renderAPI;

    expect(root.querySelector('[class*="anim-"]')).toBeNull();
  });
});
