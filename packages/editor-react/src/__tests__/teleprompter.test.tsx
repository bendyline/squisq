/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { buildNarrationScript } from '@bendyline/squisq/narration';
import { DEFAULT_THEME } from '@bendyline/squisq/schemas';
import { TeleprompterView } from '../teleprompter/TeleprompterView';
import { TeleprompterSurface } from '../teleprompter/TeleprompterSurface';
import { stepScroll, targetOffsetFor, type TokenLineMap } from '../teleprompter/scrollModel';
import { createFloatingWindowManager, detectFloatTiers } from '../teleprompter/floatingWindow';
import { PCM_WORKLET_SOURCE, PCM_WORKLET_NAME } from '../teleprompter/pcmWorklet';
import { useTeleprompter, vadConfigForSensitivity } from '../teleprompter/useTeleprompter';
import { DEFAULT_TELEPROMPTER_PREFS, normalizeTeleprompterPrefs } from '../teleprompter/types';

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

/**
 * Regression coverage for orphaned floating windows.
 *
 * The bug: `manager.open()` had no generation guard around its awaits
 * (`documentPictureInPicture.requestWindow()`, `video.play()`,
 * `requestPictureInPicture()`). A `close()`/`dispose()` landing while one of
 * those was pending — the user leaving Narrate, the view unmounting, or a
 * double-click producing two opens — still assigned the resolved float to
 * `active`. After `dispose()` that meant an always-on-top Document-PiP window
 * with an empty root, no owner, and nothing that would ever close it.
 *
 * The fix: a float resolving after a close/dispose (or superseded by a newer
 * open) is disposed on arrival, never adopted.
 */
describe('createFloatingWindowManager — late-resolving floats', () => {
  interface PipStub {
    closed: boolean;
    document: Document;
    addEventListener: () => void;
    removeEventListener: () => void;
    close: () => void;
  }

  /**
   * Installs a Document-PiP API whose `requestWindow` stays pending until the
   * returned `release()` runs — the window in which close/dispose can race.
   */
  function installDeferredDocPip() {
    const opened: PipStub[] = [];
    let release: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const win = window as Window & { documentPictureInPicture?: unknown };
    win.documentPictureInPicture = {
      requestWindow: async () => {
        await pending;
        const doc = document.implementation.createHTMLDocument('float');
        const stub: PipStub = {
          closed: false,
          document: doc,
          addEventListener: () => {},
          removeEventListener: () => {},
          close: () => {
            stub.closed = true;
          },
        };
        opened.push(stub);
        return stub as unknown as Window;
      },
    };
    return {
      opened,
      release: () => release?.(),
      cleanup: () => delete win.documentPictureInPicture,
    };
  }

  const OPTS = {
    width: 320,
    height: 480,
    title: 'Prompter',
    preferredTier: 'document-pip' as const,
  };

  it('closes (not adopts) a float that resolves after close()', async () => {
    const pip = installDeferredDocPip();
    try {
      const manager = createFloatingWindowManager({ styleCss: '' });
      const opening = manager.open(OPTS);

      manager.close(); // user brings the prompter back while PiP is pending
      pip.release();
      const tier = await opening;

      expect(tier).toBe('docked');
      expect(manager.isOpen).toBe(false);
      expect(manager.getPortalTarget()).toBeNull();
      // The window did open — it must have been closed on arrival.
      expect(pip.opened).toHaveLength(1);
      expect(pip.opened[0].closed).toBe(true);
    } finally {
      pip.cleanup();
    }
  });

  it('closes a float that resolves after dispose()', async () => {
    const pip = installDeferredDocPip();
    try {
      const manager = createFloatingWindowManager({ styleCss: '' });
      const opening = manager.open(OPTS);

      manager.dispose(); // view unmounted mid-open
      pip.release();
      const tier = await opening;

      expect(tier).toBe('docked');
      expect(manager.isOpen).toBe(false);
      // Otherwise: an always-on-top window with an empty root and no owner.
      expect(pip.opened[0].closed).toBe(true);
    } finally {
      pip.cleanup();
    }
  });

  it('keeps only the newest float when opens overlap', async () => {
    const first = installDeferredDocPip();
    const manager = createFloatingWindowManager({ styleCss: '' });
    try {
      const firstOpen = manager.open(OPTS);
      // A second open supersedes the first (double-click on the float button).
      const second = installDeferredDocPip();
      try {
        const secondOpen = manager.open(OPTS);
        first.release();
        second.release();
        const [firstTier, secondTier] = await Promise.all([firstOpen, secondOpen]);

        expect(firstTier).toBe('docked');
        expect(secondTier).toBe('document-pip');
        expect(manager.isOpen).toBe(true);
        // The superseded float must not linger.
        expect(first.opened[0].closed).toBe(true);
        expect(second.opened[0].closed).toBe(false);
      } finally {
        second.cleanup();
      }
    } finally {
      manager.dispose();
      first.cleanup();
    }
  });

  it('still adopts an uncontested float', async () => {
    const pip = installDeferredDocPip();
    const manager = createFloatingWindowManager({ styleCss: '' });
    try {
      const opening = manager.open(OPTS);
      pip.release();
      const tier = await opening;

      // The guard must not break the path it protects.
      expect(tier).toBe('document-pip');
      expect(manager.isOpen).toBe(true);
      expect(manager.getPortalTarget()).not.toBeNull();
      expect(pip.opened[0].closed).toBe(false);
    } finally {
      manager.dispose();
      pip.cleanup();
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

describe('normalizeTeleprompterPrefs', () => {
  it('clamps finite numeric preferences to their supported ranges', () => {
    expect(
      normalizeTeleprompterPrefs({ fontSizePx: 10_000, baseWpm: -50, vadSensitivity: 4 }),
    ).toMatchObject({ fontSizePx: 96, baseWpm: 80, vadSensitivity: 1 });
  });

  it('rejects invalid persisted types, enum values, and non-finite numbers', () => {
    expect(
      normalizeTeleprompterPrefs({
        fontSizePx: Number.NaN,
        baseWpm: Number.POSITIVE_INFINITY,
        mirrored: 'false',
        voiceTracking: 0,
        countdownSec: 7,
        lineGuide: null,
        micDeviceId: { value: 'device' },
      }),
    ).toEqual(DEFAULT_TELEPROMPTER_PREFS);
  });

  it('uses the current preferences as fallback when sanitizing a patch', () => {
    const current = { ...DEFAULT_TELEPROMPTER_PREFS, baseWpm: 210, mirrored: true };
    expect(normalizeTeleprompterPrefs({ ...current, baseWpm: 'fast' }, current)).toMatchObject({
      baseWpm: 210,
      mirrored: true,
    });
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

  it('mirrors the live surface into a presentation target without duplicating controls', () => {
    const doc = markdownToDoc(parseMarkdown(MD));
    const audienceDocument = document.implementation.createHTMLDocument('Audience');
    const audienceTarget = audienceDocument.createElement('div');
    audienceDocument.body.appendChild(audienceTarget);

    render(
      <TeleprompterView doc={doc} theme={DEFAULT_THEME} presentationTarget={audienceTarget} />,
    );

    expect(audienceTarget.querySelector('[aria-label="Audience presentation"]')).toBeTruthy();
    expect(audienceTarget.querySelectorAll('[data-token-idx]').length).toBe(
      buildNarrationScript(doc).tokens.length,
    );
    expect(audienceTarget.querySelector('[data-testid="teleprompter-controls"]')).toBeNull();
    expect(screen.getAllByTestId('teleprompter-controls')).toHaveLength(1);
  });

  it('shows an empty state for an empty doc', () => {
    renderView(null);
    expect(screen.getByText(/Nothing to narrate yet/)).toBeTruthy();
    expect(screen.queryByTestId('teleprompter-controls')).toBeNull();
  });

  it('mirrors the empty state into a presentation target', () => {
    const audienceDocument = document.implementation.createHTMLDocument('Audience');
    const audienceTarget = audienceDocument.createElement('div');
    audienceDocument.body.appendChild(audienceTarget);

    render(
      <TeleprompterView doc={null} theme={DEFAULT_THEME} presentationTarget={audienceTarget} />,
    );

    expect(audienceTarget.querySelector('[aria-label="Audience presentation"]')).toBeTruthy();
    expect(audienceTarget.textContent).toContain('Nothing to narrate yet');
    expect(audienceTarget.querySelector('[data-testid="teleprompter-controls"]')).toBeNull();
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

  it('nudges one word with left/right arrows while preserving line-sized up/down jumps', () => {
    const doc = markdownToDoc(parseMarkdown(MD));
    function Harness() {
      const controller = useTeleprompter({ doc });
      return (
        <div data-testid="input-harness" onKeyDown={controller.handleKeyDown}>
          <output data-testid="word-position">{controller.wordPos}</output>
          <output data-testid="transport-state">{controller.transport}</output>
          <input aria-label="Editable control" />
          <button type="button">Ordinary button</button>
          <button type="button" role="tab">
            Arrow-driven tab
          </button>
        </div>
      );
    }
    render(<Harness />);
    const harness = screen.getByTestId('input-harness');

    fireEvent.keyDown(harness, { key: 'ArrowRight' });
    expect(screen.getByTestId('word-position').textContent).toBe('1');
    fireEvent.keyDown(harness, { key: 'ArrowRight' });
    expect(screen.getByTestId('word-position').textContent).toBe('2');
    fireEvent.keyDown(harness, { key: 'ArrowRight', repeat: true });
    expect(screen.getByTestId('word-position').textContent).toBe('2');
    fireEvent.keyDown(harness, { key: 'ArrowLeft' });
    expect(screen.getByTestId('word-position').textContent).toBe('1');

    // Vertical arrows explicitly control automatic advancement.
    fireEvent.keyDown(harness, { key: 'ArrowUp' });
    expect(screen.getByTestId('transport-state').textContent).toBe('countdown');
    fireEvent.keyDown(harness, { key: 'ArrowDown' });
    expect(screen.getByTestId('transport-state').textContent).toBe('stopped');
    expect(screen.getByTestId('word-position').textContent).toBe('1');

    // Space is deliberately not a Narrate transport shortcut.
    fireEvent.keyDown(harness, { key: ' ' });
    expect(screen.getByTestId('transport-state').textContent).toBe('stopped');

    // Narrate shortcuts must not steal arrows from its form controls.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Editable control' }), {
      key: 'ArrowRight',
    });
    expect(screen.getByTestId('word-position').textContent).toBe('1');

    // Ordinary button focus does not disable global Narrate navigation.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Ordinary button' }), {
      key: 'ArrowRight',
    });
    expect(screen.getByTestId('word-position').textContent).toBe('2');

    // Widgets that own arrow-key navigation retain their native behavior.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Arrow-driven tab' }), {
      key: 'ArrowRight',
    });
    expect(screen.getByTestId('word-position').textContent).toBe('2');
  });

  it('turns wheel travel on the script surface into gentle one-word nudges', () => {
    const doc = markdownToDoc(parseMarkdown(MD));
    const script = buildNarrationScript(doc);
    const onNudge = vi.fn();
    const onSeekToken = vi.fn();
    const onToggleAutoAdvance = vi.fn();
    render(
      <TeleprompterSurface
        script={script}
        wordPos={0}
        fontSizePx={48}
        mirrored={false}
        lineGuide={false}
        countdownRemaining={null}
        recordingIndicator={false}
        theme={DEFAULT_THEME}
        onNudge={onNudge}
        onSeekToken={onSeekToken}
        onToggleAutoAdvance={onToggleAutoAdvance}
      />,
    );
    const surface = screen.getByTestId('teleprompter-surface');
    const wheel = (deltaY: number, timeStamp: number, ctrlKey = false) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ctrlKey });
      Object.defineProperty(event, 'timeStamp', { value: timeStamp });
      fireEvent(surface, event);
    };

    // Even a tiny high-resolution trackpad delta nudges immediately.
    wheel(1, 1_000);
    expect(onNudge).toHaveBeenLastCalledWith(1);

    // Sustained gestures can advance again after the shorter 60 ms throttle.
    wheel(1, 1_050);
    expect(onNudge).toHaveBeenCalledTimes(1);
    wheel(1, 1_061);
    expect(onNudge).toHaveBeenCalledTimes(2);

    // Reversing direction is immediate too.
    wheel(-1, 1_062);
    expect(onNudge).toHaveBeenLastCalledWith(-1);
    expect(onNudge).toHaveBeenCalledTimes(3);

    // Preserve browser zoom gestures.
    wheel(100, 1_200, true);
    expect(onNudge).toHaveBeenCalledTimes(3);

    const word = surface.querySelector<HTMLElement>('[data-token-idx="5"]')!;
    fireEvent.click(word);
    expect(onSeekToken).not.toHaveBeenCalled();
    fireEvent.doubleClick(word);
    expect(onSeekToken).toHaveBeenCalledWith(5);

    fireEvent.mouseDown(surface, { button: 0 });
    expect(onToggleAutoAdvance).not.toHaveBeenCalled();
    fireEvent.mouseDown(surface, { button: 1 });
    expect(onToggleAutoAdvance).toHaveBeenCalledTimes(1);
    fireEvent(surface, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(onToggleAutoAdvance).toHaveBeenCalledTimes(1);
  });
});
