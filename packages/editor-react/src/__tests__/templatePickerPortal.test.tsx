import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TEMPLATE_GALLERY_PORTAL_ID,
  TEMPLATE_GALLERY_PORTAL_SELECTOR,
  TemplateBadgePopover,
} from '../TemplatePicker';

const anchorRect = new DOMRect(20, 20, 80, 24);
const originalElementsFromPoint = document.elementsFromPoint;

function badge(key: string) {
  return (
    <TemplateBadgePopover
      key={key}
      anchorRect={anchorRect}
      value=""
      onChange={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: originalElementsFromPoint,
  });
});

describe('template gallery portal ids', () => {
  it('preserves the legacy id for a single open heading-badge gallery', () => {
    render(badge('only'));

    const gallery = document.querySelector(TEMPLATE_GALLERY_PORTAL_SELECTOR);
    expect(gallery).not.toBeNull();
    expect(gallery?.id).toBe(TEMPLATE_GALLERY_PORTAL_ID);
  });

  it('keeps concurrent editor galleries unique and promotes the survivor', () => {
    const view = render(
      <>
        {badge('first')}
        {badge('second')}
      </>,
    );

    const galleries = [...document.querySelectorAll(TEMPLATE_GALLERY_PORTAL_SELECTOR)];
    expect(galleries).toHaveLength(2);
    expect(new Set(galleries.map((gallery) => gallery.id)).size).toBe(2);
    expect(galleries.filter((gallery) => gallery.id === TEMPLATE_GALLERY_PORTAL_ID)).toHaveLength(
      1,
    );

    view.rerender(<>{badge('second')}</>);
    const survivor = document.querySelector(TEMPLATE_GALLERY_PORTAL_SELECTOR);
    expect(survivor?.id).toBe(TEMPLATE_GALLERY_PORTAL_ID);
  });
});
