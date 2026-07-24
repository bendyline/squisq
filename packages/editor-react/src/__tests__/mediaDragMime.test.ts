import { describe, expect, it } from 'vitest';
import {
  buildSquisqMediaReference,
  squisqMediaKind,
  type SquisqMediaDragPayload,
} from '../mediaDragMime';

function payload(name: string, mimeType: string, alt = 'media file'): SquisqMediaDragPayload {
  return { name, mimeType, alt };
}

describe('Files-panel media drag references', () => {
  it('classifies image, video, audio, and generic files', () => {
    expect(squisqMediaKind('image/png')).toBe('image');
    expect(squisqMediaKind('video/webm')).toBe('video');
    expect(squisqMediaKind('audio/ogg')).toBe('audio');
    expect(squisqMediaKind('application/pdf')).toBe('file');
  });

  it('builds an editable image reference', () => {
    expect(buildSquisqMediaReference(payload('images/photo.png', 'image/png', 'photo'))).toBe(
      '![photo](images/photo.png)',
    );
  });

  it('builds playable video and audio elements', () => {
    expect(buildSquisqMediaReference(payload('video/screen.webm', 'video/webm'))).toBe(
      '<video src="video/screen.webm" controls width="480"></video>',
    );
    expect(buildSquisqMediaReference(payload('audio/narration.ogg', 'audio/ogg'))).toBe(
      '<audio src="audio/narration.ogg" controls></audio>',
    );
  });

  it('keeps other files as links and escapes playable-media HTML paths', () => {
    expect(buildSquisqMediaReference(payload('files/brief.pdf', 'application/pdf', 'brief'))).toBe(
      '[brief](files/brief.pdf)',
    );
    expect(buildSquisqMediaReference(payload('video/a&b.webm', 'video/webm'))).toContain(
      'src="video/a&amp;b.webm"',
    );
  });
});
