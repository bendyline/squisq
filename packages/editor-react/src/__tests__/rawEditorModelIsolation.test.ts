import { describe, expect, it, vi } from 'vitest';
import {
  canHandleSquisqMediaDrop,
  isMarkdownFencedCodeModelLine,
  ownsMonacoModel,
} from '../rawEditorIsolation';
import { SQUISQ_MEDIA_MIME } from '../mediaDragMime';

describe('RawEditor Monaco provider isolation', () => {
  it('accepts only the model owned by the registering editor', () => {
    const firstModel = {} as never;
    const secondModel = {} as never;
    const firstEditor = { getModel: () => firstModel } as never;
    expect(ownsMonacoModel(firstEditor, firstModel)).toBe(true);
    expect(ownsMonacoModel(firstEditor, secondModel)).toBe(false);
  });

  it('caches fenced-code lines by Monaco model version', () => {
    let versionId = 1;
    let source = ['Before', '```md', '{[inside]}', '```', 'After'].join('\n');
    const getValue = vi.fn(() => source);
    const model = {
      getValue,
      getVersionId: () => versionId,
    };

    expect(isMarkdownFencedCodeModelLine(model, 3)).toBe(true);
    expect(isMarkdownFencedCodeModelLine(model, 5)).toBe(false);
    expect(getValue).toHaveBeenCalledTimes(1);

    versionId = 2;
    source = ['Before', 'After', '```md', '{[inside]}', '```'].join('\n');

    expect(isMarkdownFencedCodeModelLine(model, 3)).toBe(true);
    expect(isMarkdownFencedCodeModelLine(model, 2)).toBe(false);
    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it('rejects media-bin drops while read-only', () => {
    const transfer = { types: [SQUISQ_MEDIA_MIME] } as unknown as DataTransfer;
    expect(canHandleSquisqMediaDrop(true, transfer)).toBe(false);
    expect(canHandleSquisqMediaDrop(false, transfer)).toBe(true);
  });
});
