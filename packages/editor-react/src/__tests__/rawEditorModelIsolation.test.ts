import { describe, expect, it } from 'vitest';
import { canHandleSquisqMediaDrop, ownsMonacoModel } from '../rawEditorIsolation';
import { SQUISQ_MEDIA_MIME } from '../mediaDragMime';

describe('RawEditor Monaco provider isolation', () => {
  it('accepts only the model owned by the registering editor', () => {
    const firstModel = {} as never;
    const secondModel = {} as never;
    const firstEditor = { getModel: () => firstModel } as never;
    expect(ownsMonacoModel(firstEditor, firstModel)).toBe(true);
    expect(ownsMonacoModel(firstEditor, secondModel)).toBe(false);
  });

  it('rejects media-bin drops while read-only', () => {
    const transfer = { types: [SQUISQ_MEDIA_MIME] } as unknown as DataTransfer;
    expect(canHandleSquisqMediaDrop(true, transfer)).toBe(false);
    expect(canHandleSquisqMediaDrop(false, transfer)).toBe(true);
  });
});
