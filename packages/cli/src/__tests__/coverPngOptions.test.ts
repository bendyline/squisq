import { describe, it } from 'mocha';
import { expect } from 'chai';
import { renderDocCoverToPng } from '../api.js';
import { MemoryContentContainer } from '@bendyline/squisq/storage';

describe('renderDocCoverToPng validation', () => {
  it('rejects a document without a managed cover before browser startup', async () => {
    try {
      await renderDocCoverToPng(
        {
          articleId: 'missing-cover',
          duration: 0,
          blocks: [],
          audio: { segments: [] },
        },
        new MemoryContentContainer(),
      );
      expect.fail('Expected missing cover to reject');
    } catch (error) {
      expect(String(error)).to.contain('no managed cover');
    }
  });

  it('rejects invalid dimensions before browser startup', async () => {
    try {
      await renderDocCoverToPng(
        {
          articleId: 'cover',
          duration: 0,
          blocks: [],
          audio: { segments: [] },
          startBlock: { title: 'Cover' },
        },
        new MemoryContentContainer(),
        { width: 0, height: 1080 },
      );
      expect.fail('Expected invalid dimensions to reject');
    } catch (error) {
      expect(String(error)).to.contain('dimensions');
    }
  });
});
