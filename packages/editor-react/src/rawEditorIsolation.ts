import type * as monaco from 'monaco-editor';
import { SQUISQ_MEDIA_MIME } from './mediaDragMime';
import { markdownFencedCodeLineMask } from './markdownCodeFence';

type MarkdownTextModel = Pick<monaco.editor.ITextModel, 'getValue' | 'getVersionId'>;

interface MarkdownFenceMaskCacheEntry {
  versionId: number;
  mask: boolean[];
}

const markdownFenceMaskCache = new WeakMap<MarkdownTextModel, MarkdownFenceMaskCacheEntry>();

/** Reuse the fenced-code scan until Monaco reports a new model version. */
export function getCachedMarkdownFencedCodeLineMask(model: MarkdownTextModel): readonly boolean[] {
  const versionId = model.getVersionId();
  const cached = markdownFenceMaskCache.get(model);
  if (cached?.versionId === versionId) return cached.mask;

  const mask = markdownFencedCodeLineMask(model.getValue());
  markdownFenceMaskCache.set(model, { versionId, mask });
  return mask;
}

/** Whether a 1-based Monaco model line is inside a Markdown code fence. */
export function isMarkdownFencedCodeModelLine(
  model: MarkdownTextModel,
  lineNumber: number,
): boolean {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return false;
  return getCachedMarkdownFencedCodeLineMask(model)[lineNumber - 1] ?? false;
}

/** Monaco completion providers are global; accept only their owner's model. */
export function ownsMonacoModel(
  editor: Pick<monaco.editor.IStandaloneCodeEditor, 'getModel'>,
  model: monaco.editor.ITextModel,
): boolean {
  return editor.getModel() === model;
}

/** Native media-bin drops are mutations and must be blocked in read-only mode. */
export function canHandleSquisqMediaDrop(
  readOnly: boolean,
  dataTransfer: DataTransfer | null,
): boolean {
  return !readOnly && !!dataTransfer?.types.includes(SQUISQ_MEDIA_MIME);
}
