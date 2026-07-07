/**
 * Tests for the consolidated ext→MIME map (`shared/images.ts`) and the html
 * `inferMimeType` wrapper that now delegates to it. This map is the union of
 * the three previously-drifting copies (docx/pptx importers + html export).
 */

import { describe, it, expect } from 'vitest';
import { extToMime } from '../shared/images';
import { inferMimeType } from '../html/imageUtils';

describe('extToMime', () => {
  it('is dot-tolerant and case-insensitive', () => {
    expect(extToMime('png')).toBe('image/png');
    expect(extToMime('.png')).toBe('image/png');
    expect(extToMime('.PNG')).toBe('image/png');
    expect(extToMime('PNG')).toBe('image/png');
  });

  it('resolves .avif to image/avif (the correct answer where the old maps disagreed)', () => {
    // html's map had avif→image/avif; the docx/pptx maps omitted it entirely
    // (would have fallen back to octet-stream). The union picks image/avif.
    expect(extToMime('avif')).toBe('image/avif');
    expect(extToMime('.avif')).toBe('image/avif');
  });

  it('covers the union of all three previous maps', () => {
    // Raster/vector (all three had most of these)
    expect(extToMime('jpg')).toBe('image/jpeg');
    expect(extToMime('jpeg')).toBe('image/jpeg');
    expect(extToMime('gif')).toBe('image/gif');
    expect(extToMime('webp')).toBe('image/webp');
    expect(extToMime('bmp')).toBe('image/bmp');
    expect(extToMime('svg')).toBe('image/svg+xml');
    // Only docx/pptx had these
    expect(extToMime('tiff')).toBe('image/tiff');
    expect(extToMime('tif')).toBe('image/tiff');
    expect(extToMime('emf')).toBe('image/emf');
    expect(extToMime('wmf')).toBe('image/wmf');
    // Only html had these
    expect(extToMime('ico')).toBe('image/x-icon');
    expect(extToMime('mp3')).toBe('audio/mpeg');
    expect(extToMime('wav')).toBe('audio/wav');
    expect(extToMime('ogg')).toBe('audio/ogg');
    expect(extToMime('mp4')).toBe('video/mp4');
    expect(extToMime('webm')).toBe('video/webm');
  });

  it('returns application/octet-stream for unknown / empty extensions', () => {
    expect(extToMime('xyz')).toBe('application/octet-stream');
    expect(extToMime('')).toBe('application/octet-stream');
  });
});

describe('inferMimeType (html wrapper)', () => {
  it('delegates to extToMime, keying off the filename extension', () => {
    expect(inferMimeType('images/hero.PNG')).toBe('image/png');
    expect(inferMimeType('photo.avif')).toBe('image/avif');
    expect(inferMimeType('clip.webm')).toBe('video/webm');
    expect(inferMimeType('noextension')).toBe('application/octet-stream');
  });
});
