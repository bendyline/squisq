import { describe, expect, it } from 'vitest';
import { coverImageFilename, validateCoverImageDimensions } from '../CoverImageExportModal';

describe('cover image export configuration', () => {
  it('builds a safe filename with the selected extension', () => {
    expect(coverImageFilename('Quarterly plan.md', 'png')).toBe('Quarterly plan-cover.png');
    expect(coverImageFilename('bad:<name>.md', 'jpeg')).toBe('bad--name--cover.jpg');
    expect(coverImageFilename(undefined, 'webp')).toBe('document-cover.webp');
  });

  it('bounds dimensions and total raster memory', () => {
    expect(validateCoverImageDimensions(1920, 1080)).toBeNull();
    expect(validateCoverImageDimensions(3840, 2160)).toBeNull();
    expect(validateCoverImageDimensions(63, 1080)).toContain('between 64 and 7680');
    expect(validateCoverImageDimensions(7680, 7680)).toContain('33 megapixels');
    expect(validateCoverImageDimensions(1920.5, 1080)).toContain('whole numbers');
  });
});
