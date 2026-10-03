import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { convert } from '../registry/convert.js';
import type { Doc } from '@bendyline/squisq/schemas';
const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
describe('review: conversion integrity', () => {
  it.each([100, 101, 1000])(
    'preserves a CSV table with %s rows across the sidecar threshold',
    async (rows) => {
      const csv =
        'Name,Value\n' + Array.from({ length: rows }, (_, i) => `item${i},${i}`).join('\n') + '\n';
      const result = await convert(
        { kind: 'bytes', data: encode(csv), filename: 'input.csv' },
        'csv',
      );
      expect(new TextDecoder().decode(result.bytes)).toContain(`item${rows - 1},${rows - 1}`);
    },
  );
  it('includes container narration audio in a self-contained HTML ZIP', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile('audio/take.mp3', encode('sample audio'), 'audio/mpeg');
    const doc: Doc = {
      articleId: 'audio-export',
      duration: 1,
      blocks: [{ id: 'b1', startTime: 0, duration: 1, audioSegment: 0, layers: [] }],
      audio: { segments: [{ name: 'take', src: 'audio/take.mp3', startTime: 0, duration: 1 }] },
    };
    const result = await convert({ kind: 'doc', doc, container }, 'htmlzip', {
      resolvePlayerScript: async () => '// test player stub',
      formatOptions: { htmlzip: { mode: 'slideshow' } },
    });
    const zip = await JSZip.loadAsync(result.bytes);
    expect(Object.keys(zip.files).filter((name) => name.endsWith('.mp3'))).toContain(
      'audio/take.mp3',
    );
  });
});
