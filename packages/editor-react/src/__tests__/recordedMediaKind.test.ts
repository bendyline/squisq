import { describe, expect, it } from 'vitest';
import { recordedMediaKind } from '../recorder/recordedMediaKind';

function streamWithVideoTrack(count: number): Pick<MediaStream, 'getVideoTracks'> {
  return {
    getVideoTracks: () => Array.from({ length: count }) as MediaStreamTrack[],
  };
}

describe('recordedMediaKind', () => {
  it('uses the tracks actually present instead of the requested source or container MIME', () => {
    expect(recordedMediaKind('screen', streamWithVideoTrack(0), 'video/webm')).toBe('audio');
    expect(recordedMediaKind('camera', streamWithVideoTrack(1), 'audio/webm')).toBe('video');
  });

  it('falls back to MIME and requested source when no stream is available', () => {
    expect(recordedMediaKind('screen', null, 'audio/webm')).toBe('audio');
    expect(recordedMediaKind('mic', null, 'application/octet-stream')).toBe('audio');
    expect(recordedMediaKind('screen', null, 'video/webm')).toBe('video');
  });
});
