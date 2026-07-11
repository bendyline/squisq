import type * as monaco from 'monaco-editor';
import { SQUISQ_MEDIA_MIME } from './mediaDragMime';

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
