/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { buildNarrationScript } from '@bendyline/squisq/narration';
import { DEFAULT_THEME } from '@bendyline/squisq/schemas';
import { TeleprompterView } from '../teleprompter/TeleprompterView';
import { stepScroll, targetOffsetFor, type TokenLineMap } from '../teleprompter/scrollModel';
import { detectFloatTiers } from '../teleprompter/floatingWindow';
import { PCM_WORKLET_SOURCE, PCM_WORKLET_NAME } from '../teleprompter/pcmWorklet';
import { vadConfigForSensitivity } from '../teleprompter/useTeleprompter';

const MD = `# First Section

One two three four five six seven eight.

## Second Section

Nine ten eleven twelve.
`;

afterEach(() => {
  cleanup();
  // Prefs persist to localStorage; keep tests order-independent.
  window.localStorage.removeItem('squisq:teleprompter-prefs');
});

describe('scrollModel', () => {
  const lines: TokenLineMap = {
    tokenTops: [0, 0, 0, 60, 60, 120, 120, 180],
    tokenHeights: [60, 60, 60, 60, 60, 60, 60, 60],
  };

  it('places the active line at the eye-line', () => {
    // Token 5 sits at top 120; eye-line = 35% of 600 = 210 → offset keeps it clamped ≥ 0.
    expect(targetOffsetFor(5, lines, 600)).toBe(0);
    // Smaller viewport pushes real scrolling: 120 + 30 − 0.35×200 = 80.
    expect(targetOffsetFor(5, lines, 200)).toBe(80);
    // Fractional positions interpolate between token tops.
    expect(targetOffsetFor(4.5, lines, 200)).toBe(60 + 30 + 30 - 70);
  });

  it('clamps to non-negative offsets and empty maps', () => {
    expect(targetOffsetFor(0, lines, 600)).toBe(0);
    expect(targetOffsetFor(3, { tokenTops: [], tokenHeights: [] }, 600)).toBe(0);
  });

  it('stepScroll approaches the target and respects the speed clamp', () => {
    // A huge jump advances by at most maxPxPerSec × dt.
    expect(stepScroll(0, 100000, 16, 2600)).toBeCloseTo(2600 * 0.016, 5);
    // Small distances converge and snap exactly.
    let offset = 0;
    for (let i = 0; i < 120; i++) offset = stepScroll(offset, 300, 16);
    expect(offset).toBe(300);
    // No time → no movement.
    expect(stepScroll(50, 300, 0)).toBe(50);
  });
});

describe('detectFloatTiers', () => {
  it('reports popup + docked under jsdom (no PiP APIs)', () => {
    const tiers = detectFloatTiers();
    expect(tiers).toContain('popup');
    expect(tiers[tiers.length - 1]).toBe('docked');
    expect(tiers).not.toContain('document-pip');
    expect(tiers).not.toContain('video-pip');
  });

  it('reports document-pip first when the API exists', () => {
    const win = window as Window & { documentPictureInPicture?: unknown };
    win.documentPictureInPicture = { requestWindow: () => Promise.reject(new Error('stub')) };
    try {
      expect(detectFloatTiers()[0]).toBe('document-pip');
    } finally {
      delete win.documentPictureInPicture;
    }
  });
});

describe('pcmWorklet source', () => {
  it('compiles under stubbed worklet globals and registers the tap', () => {
    const registered: string[] = [];
    const factory = new Function(
      'registerProcessor',
      'AudioWorkletProcessor',
      'currentTime',
      PCM_WORKLET_SOURCE,
    );
    class ProcessorStub {
      port = { postMessage: () => undefined };
    }
    factory((name: string) => registered.push(name), ProcessorStub, 0);
    expect(registered).toEqual([PCM_WORKLET_NAME]);
    expect(PCM_WORKLET_SOURCE).toContain('process(inputs)');
  });
});

describe('vadConfigForSensitivity', () => {
  it('maps 0.5 to the engine defaults and keeps hysteresis ordering', () => {
    const mid = vadConfigForSensitivity(0.5);
    expect(mid.enterRatio).toBeCloseTo(3.0, 5);
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const cfg = vadConfigForSensitivity(s);
      expect(cfg.enterRatio!).toBeGreaterThan(cfg.exitRatio! - 1e-9);
    }
    // Higher sensitivity → lower (easier) enter threshold.
    expect(vadConfigForSensitivity(0.9).enterRatio!).toBeLessThan(
      vadConfigForSensitivity(0.1).enterRatio!,
    );
  });
});

describe('TeleprompterView', () => {
  function renderView(markdown: string | null) {
    const doc = markdown ? markdownToDoc(parseMarkdown(markdown)) : null;
    render(<TeleprompterView doc={doc} theme={DEFAULT_THEME} />);
    return doc;
  }

  it('renders one span per script token plus block markers and controls', () => {
    const doc = renderView(MD);
    const script = buildNarrationScript(doc!);
    const spans = document.querySelectorAll('[data-token-idx]');
    expect(spans.length).toBe(script.tokens.length);
    expect(
      screen.getByText('First Section', { selector: '.squisq-teleprompter-block-marker' }),
    ).toBeTruthy();
    expect(screen.getByTestId('teleprompter-controls')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start prompter' })).toBeTruthy();
  });

  it('shows an empty state for an empty doc', () => {
    renderView(null);
    expect(screen.getByText(/Nothing to narrate yet/)).toBeTruthy();
    expect(screen.queryByTestId('teleprompter-controls')).toBeNull();
  });

  it('start button enters countdown and Escape cancels back to stopped', () => {
    renderView(MD);
    fireEvent.click(screen.getByRole('button', { name: 'Start prompter' }));
    // Default prefs use a 3 s countdown → the overlay digit appears.
    expect(document.querySelector('.squisq-teleprompter-countdown-digit')?.textContent).toBe('3');
    fireEvent.keyDown(screen.getByTestId('teleprompter-view'), { key: 'Escape' });
    expect(document.querySelector('.squisq-teleprompter-countdown-digit')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start prompter' })).toBeTruthy();
  });

  it('mirror toggle flips the surface class', () => {
    renderView(MD);
    const surface = screen.getByTestId('teleprompter-surface');
    expect(surface.className).not.toContain('--mirrored');
    fireEvent.click(screen.getByRole('button', { name: '⇋ Mirror' }));
    expect(screen.getByTestId('teleprompter-surface').className).toContain('--mirrored');
  });
});
