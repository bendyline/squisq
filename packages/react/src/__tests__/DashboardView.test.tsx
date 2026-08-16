import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import type { SquisqRenderAPI } from '../types';
import { DashboardView } from '../DashboardView';

function testDoc(blockCount: number, frontmatter?: Record<string, unknown>): Doc {
  return {
    articleId: 'dashboard-view-test',
    duration: blockCount * 5,
    ...(frontmatter ? { frontmatter } : {}),
    blocks: Array.from({ length: blockCount }, (_, index) => ({
      id: `b${index + 1}`,
      startTime: index * 5,
      duration: 5,
      audioSegment: 0,
      title: `Block ${index + 1}`,
    })),
    audio: { segments: [] },
  } as Doc;
}

describe('DashboardView', () => {
  it('renders one cell per block in the auto-picked layout', () => {
    const { container } = render(<DashboardView doc={testDoc(6)} />);
    const root = container.querySelector('.squisq-dashboard');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-dashboard-layout')).toBe('grid-3x2');
    expect(container.querySelectorAll('.squisq-dashboard__cell')).toHaveLength(6);
    // Each cell hosts its own BlockRenderer SVG.
    expect(container.querySelectorAll('.squisq-dashboard__cell svg.block-svg')).toHaveLength(6);
  });

  it('drops overflow blocks beyond the layout capacity', () => {
    const { container } = render(<DashboardView doc={testDoc(6)} layout="grid-2x2" />);
    expect(
      container.querySelector('.squisq-dashboard')?.getAttribute('data-dashboard-layout'),
    ).toBe('grid-2x2');
    expect(container.querySelectorAll('.squisq-dashboard__cell')).toHaveLength(4);
    expect(container.textContent).not.toContain('Block 5');
  });

  it('shows the title band by default when a title resolves, and hides it on demand', () => {
    const doc = testDoc(4, { title: 'Quarterly Wall' });
    const shown = render(<DashboardView doc={doc} />);
    expect(shown.container.querySelector('.squisq-dashboard__title')).not.toBeNull();
    expect(shown.container.textContent).toContain('Quarterly Wall');

    const hidden = render(<DashboardView doc={doc} showTitle={false} />);
    expect(hidden.container.querySelector('.squisq-dashboard__title')).toBeNull();

    // No resolvable title → no band even though the default is on.
    const untitled = render(<DashboardView doc={testDoc(4)} />);
    expect(untitled.container.querySelector('.squisq-dashboard__title')).toBeNull();
  });

  it('uses the host documentTitle fallback for the band', () => {
    const { container } = render(<DashboardView doc={testDoc(2)} documentTitle="From Filename" />);
    expect(container.textContent).toContain('From Filename');
  });

  it('exposes the contain-fit hooks: var-driven width + aspect custom property', () => {
    const { container } = render(
      <DashboardView doc={testDoc(2)} viewport={{ width: 1080, height: 1920, name: 'portrait' }} />,
    );
    const root = container.querySelector('.squisq-dashboard') as HTMLElement;
    // Hosts contain-fit by defining --squisq-dashboard-fit-width; the default
    // keeps the historical width-driven behavior.
    expect(root.style.width).toBe('var(--squisq-dashboard-fit-width, 100%)');
    expect(root.style.getPropertyValue('--squisq-dashboard-aspect')).toBe('0.562500');
  });

  it('keeps SVG clip ids distinct across cells', () => {
    const { container } = render(<DashboardView doc={testDoc(4)} />);
    const clipIds = Array.from(container.querySelectorAll('clipPath')).map((clip) => clip.id);
    expect(clipIds.length).toBeGreaterThanOrEqual(4);
    expect(new Set(clipIds).size).toBe(clipIds.length);
  });

  it('publishes a render API in render mode whose seekTo resolves, and null on cleanup', async () => {
    const received: Array<SquisqRenderAPI | null> = [];
    const onRenderAPIReady = vi.fn((api: SquisqRenderAPI | null) => received.push(api));
    const { unmount } = render(
      <DashboardView doc={testDoc(3)} renderMode onRenderAPIReady={onRenderAPIReady} />,
    );
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
    const api = received[0]!;
    expect(api).not.toBeNull();
    expect(api.getDuration()).toBe(0);
    expect(api.hasCoverBlock()).toBe(false);
    expect(api.getBlocks()).toHaveLength(3);
    expect(api.getBlocks()[0]).toMatchObject({ id: 'b1', startTime: 0, duration: 0 });
    await expect(api.seekTo(0)).resolves.toBeUndefined();
    unmount();
    expect(received[received.length - 1]).toBeNull();
  });

  it('does not publish a render API outside render mode', () => {
    const onRenderAPIReady = vi.fn();
    render(<DashboardView doc={testDoc(2)} onRenderAPIReady={onRenderAPIReady} />);
    expect(onRenderAPIReady).not.toHaveBeenCalled();
  });

  it('paints no cell chrome under the default basic style', () => {
    const { container } = render(<DashboardView doc={testDoc(4)} />);
    expect(container.querySelector('.squisq-dashboard')?.getAttribute('data-dashboard-style')).toBe(
      'basic',
    );
    expect(container.querySelectorAll('.squisq-dashboard__frame')).toHaveLength(0);
    const cell = container.querySelector('.squisq-dashboard__cell') as HTMLElement;
    expect(cell.style.borderRadius).toBe('');
  });

  it('renders one chrome frame per cell and clips the cell to the card corners', () => {
    const { container } = render(<DashboardView doc={testDoc(4)} style="card" />);
    expect(container.querySelector('.squisq-dashboard')?.getAttribute('data-dashboard-style')).toBe(
      'card',
    );
    const frames = container.querySelectorAll('.squisq-dashboard__frame');
    expect(frames).toHaveLength(4);
    expect(container.querySelectorAll('.squisq-dashboard__cell')).toHaveLength(4);
    const cell = container.querySelector('.squisq-dashboard__cell') as HTMLElement;
    // Percentage radii scale with the rendered canvas at any export size.
    expect(cell.style.borderRadius).toMatch(/%/);
    expect(cell.style.overflow).toBe('hidden');
    // The block box sits inside its frame box.
    const frame = frames[0] as HTMLElement;
    expect(parseFloat(cell.style.left)).toBeGreaterThan(parseFloat(frame.style.left));
    expect(parseFloat(cell.style.width)).toBeLessThan(parseFloat(frame.style.width));
  });

  it('reads the style from frontmatter when no prop overrides it', () => {
    const { container } = render(
      <DashboardView doc={testDoc(4, { 'squisq-dashboard-style': 'panel' })} />,
    );
    expect(container.querySelector('.squisq-dashboard')?.getAttribute('data-dashboard-style')).toBe(
      'panel',
    );
    expect(container.querySelectorAll('.squisq-dashboard__frame')).toHaveLength(4);
  });
});
