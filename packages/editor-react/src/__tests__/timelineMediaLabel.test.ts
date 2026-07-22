import { describe, expect, it } from 'vitest';
import { timelineMediaLabel } from '../timelineMediaLabel';

describe('timelineMediaLabel', () => {
  it('hides video file extensions', () => {
    expect(timelineMediaLabel('video/recording-20260721-052303.webm', 'video')).toBe(
      'recording-20260721-052303',
    );
    expect(timelineMediaLabel('video/demo.final.MP4', 'video')).toBe('demo.final');
  });

  it('keeps audio file extensions', () => {
    expect(timelineMediaLabel('audio/narration.webm', 'audio')).toBe('narration.webm');
  });
});
