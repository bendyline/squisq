import { describe, expect, it } from 'vitest';
import { hasFfmpegListEntry } from '../scripts/ffmpeg-list.mjs';

describe('hasFfmpegListEntry', () => {
  it('supports FFmpeg list formats with different capability-column widths', () => {
    const olderFilters = `
 TSC palettegen        V->V       Find the optimal palette for a given stream.
 ..C paletteuse        VV->V      Use a palette to downsample an input video stream.
`;
    const ffmpeg8Filters = `
 .. palettegen         V->V       Find the optimal palette for a given stream.
 .. paletteuse         VV->V      Use a palette to downsample an input video stream.
`;

    expect(hasFfmpegListEntry(olderFilters, 'palettegen')).toBe(true);
    expect(hasFfmpegListEntry(olderFilters, 'paletteuse')).toBe(true);
    expect(hasFfmpegListEntry(ffmpeg8Filters, 'palettegen')).toBe(true);
    expect(hasFfmpegListEntry(ffmpeg8Filters, 'paletteuse')).toBe(true);
  });

  it('does not mistake a description for a listed component', () => {
    const filters = ' .. other V->V Uses the palettegen filter internally.';

    expect(hasFfmpegListEntry(filters, 'palettegen')).toBe(false);
  });
});
