import { describe, expect, it } from 'vitest';
import { fitPicture } from '../pptx/pictureLayers';

const box = { x: 100, y: 200, width: 1600, height: 900 };

describe('fitPicture', () => {
  it('covers its box by trimming what overflows, centred', () => {
    // A square photo in a 16:9 frame loses the same share top and bottom.
    const square = fitPicture(box, { width: 1000, height: 1000 }, 'cover');
    expect(square.rect).toEqual(box);
    expect(square.srcRect).toBe('<a:srcRect t="21875" b="21875"/>');
    // A panorama loses its sides instead.
    const wide = fitPicture(box, { width: 4000, height: 1000 }, 'cover');
    expect(wide.srcRect).toBe('<a:srcRect l="27778" r="27778"/>');
    // A photo already the frame's shape is not cropped.
    expect(fitPicture(box, { width: 1920, height: 1080 }, 'cover').srcRect).toBe('');
  });

  it('shows the whole picture inside its box unless told to cover or fill', () => {
    for (const fit of ['contain', undefined] as const) {
      const { rect, srcRect } = fitPicture(box, { width: 1000, height: 1000 }, fit);
      expect(srcRect).toBe('');
      expect(rect).toEqual({ x: 450, y: 200, width: 900, height: 900 });
    }
  });

  it('stretches only when asked, or when the picture’s size is unknown', () => {
    expect(fitPicture(box, { width: 1000, height: 1000 }, 'fill')).toEqual({
      rect: box,
      srcRect: '',
    });
    expect(fitPicture(box, null, 'cover')).toEqual({ rect: box, srcRect: '' });
  });
});
