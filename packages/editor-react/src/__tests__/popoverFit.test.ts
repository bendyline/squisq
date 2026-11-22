/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { fitPopoverWithinClip } from '../popoverFit';

/**
 * jsdom does no layout, so these tests stand in a model of the one CSS rule
 * the fit depends on: an absolutely positioned popover with no set width
 * shrinks to fit the room its offsets leave it inside its containing block.
 * The model follows the Version history popover: hung by `right: 0` from a
 * zero-width anchor, 1px borders, min-width 280px and max-width 360px.
 */
const BORDERS = 2;
const STYLESHEET_MIN = 280;
const STYLESHEET_MAX = 360;

interface Mounted {
  popover: HTMLElement;
  /** Swap the popover's content for content that would like `width` px. */
  setPreferredWidth(width: number): void;
}

function px(value: string, fallback: number): number {
  if (value === 'none') return Infinity;
  return value === '' ? fallback : Number.parseFloat(value);
}

function mountPopover(options: { viewport: number; anchorAt: number; preferred: number }): Mounted {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: options.viewport,
  });
  for (const element of [document.documentElement, document.body]) {
    element.style.overflowX = 'visible';
  }
  const anchor = document.createElement('div');
  anchor.style.overflowX = 'visible';
  const popover = document.createElement('div');
  anchor.append(popover);
  document.body.append(anchor);

  let preferred = options.preferred;
  const borderBoxWidth = (): number => {
    const { style } = popover;
    if (style.width !== '') {
      const width = Number.parseFloat(style.width);
      return style.boxSizing === 'border-box' ? width : width + BORDERS;
    }
    // Shrink-to-fit: the room left of the anchor once `left` is set, none
    // while the popover hangs from the anchor's right edge.
    const room = style.left !== '' ? -Number.parseFloat(style.left) - BORDERS : 0;
    const min = px(style.minWidth, STYLESHEET_MIN);
    const max = px(style.maxWidth, STYLESHEET_MAX);
    return Math.min(Math.max(Math.min(preferred, room), min), max) + BORDERS;
  };
  const left = (): number =>
    popover.style.left !== ''
      ? options.anchorAt + Number.parseFloat(popover.style.left)
      : options.anchorAt - borderBoxWidth();

  popover.getBoundingClientRect = () => {
    const width = borderBoxWidth();
    const x = left();
    return { x, y: 0, left: x, right: x + width, width, top: 0, bottom: 0, height: 0 } as DOMRect;
  };
  Object.defineProperty(popover, 'offsetLeft', { get: () => left() - options.anchorAt });

  return {
    popover,
    setPreferredWidth(width) {
      preferred = width;
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('fitPopoverWithinClip', () => {
  it('keeps the edge margin once a popover it moved gets its content', () => {
    // Version history folded on a 360px phone: its anchor sits at the screen's
    // right edge, and its list loads after the popover opens.
    const { popover, setPreferredWidth } = mountPopover({
      viewport: 360,
      anchorAt: 360,
      preferred: 60,
    });

    fitPopoverWithinClip(popover);
    setPreferredWidth(600);

    const rect = popover.getBoundingClientRect();
    expect(rect.right).toBe(352);
    expect(rect.left).toBeGreaterThanOrEqual(8);
  });

  it('moves a popover overhanging the left edge in without changing its width', () => {
    const { popover, setPreferredWidth } = mountPopover({
      viewport: 360,
      anchorAt: 120,
      preferred: 60,
    });
    const natural = popover.getBoundingClientRect().width;

    fitPopoverWithinClip(popover);
    setPreferredWidth(600);

    const rect = popover.getBoundingClientRect();
    expect(rect.left).toBe(8);
    expect(rect.width).toBe(natural);
  });

  it('gives a popover too wide for the screen exactly the room, border included', () => {
    const { popover } = mountPopover({ viewport: 280, anchorAt: 280, preferred: 600 });

    fitPopoverWithinClip(popover);

    const rect = popover.getBoundingClientRect();
    expect(rect.left).toBe(8);
    expect(rect.right).toBe(272);
  });

  it('leaves a popover that already fits as the stylesheet placed it', () => {
    const { popover } = mountPopover({ viewport: 1280, anchorAt: 900, preferred: 600 });

    fitPopoverWithinClip(popover);

    expect(popover.getAttribute('style') ?? '').toBe('');
  });

  it('measures from the stylesheet again on every call', () => {
    const { popover } = mountPopover({ viewport: 360, anchorAt: 360, preferred: 60 });
    fitPopoverWithinClip(popover);
    const first = popover.getAttribute('style');

    fitPopoverWithinClip(popover);

    expect(popover.getAttribute('style')).toBe(first);
    expect(popover.getBoundingClientRect().right).toBe(352);
  });
});
