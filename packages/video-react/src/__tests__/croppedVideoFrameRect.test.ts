import { describe, expect, it } from 'vitest';
import { croppedVideoFrameRect } from '../hooks/useFrameCapture.js';

describe('croppedVideoFrameRect', () => {
  it('matches the uncropped rect when there is no crop', () => {
    expect(croppedVideoFrameRect(1920, 1080, null, 640, 360, 'cover')).toEqual({
      sx: 0,
      sy: 0,
      sw: 1920,
      sh: 1080,
      dx: 0,
      dy: 0,
      dw: 640,
      dh: 360,
    });
  });

  it('draws only the crop region, fitted into the destination', () => {
    // Right half of a 1920×1080 frame, cover-fitted into a square box.
    const rect = croppedVideoFrameRect(
      1920,
      1080,
      { x: 0.5, y: 0, w: 0.5, h: 1 },
      400,
      400,
      'cover',
    );
    expect(rect.sx).toBeCloseTo(960, 6);
    expect(rect.sw).toBeCloseTo(960, 6);
    expect(rect.sh).toBeCloseTo(960, 6);
    expect(rect.sy).toBeCloseTo(60, 6);
    expect([rect.dx, rect.dy, rect.dw, rect.dh]).toEqual([0, 0, 400, 400]);
  });

  it('fills the destination exactly with fill', () => {
    const rect = croppedVideoFrameRect(
      1000,
      500,
      { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
      300,
      100,
      'fill',
    );
    expect([rect.sx, rect.sy, rect.sw, rect.sh]).toEqual([100, 100, 500, 250]);
  });
});
