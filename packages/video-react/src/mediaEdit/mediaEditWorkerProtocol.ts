/**
 * Messages between the main thread and the media-edit worker. Requests carry
 * the source as a Blob (structured clone shares the bytes; nothing is
 * copied); results transfer their ArrayBuffers back.
 */

import type { MediaFxAnalysis } from '@bendyline/squisq/mediaEdit';
import type {
  MediaEditPausesRequest,
  MediaEditPausesResult,
  MediaEditPreviewRequest,
  MediaEditPreviewResult,
  MediaEditRenderRequest,
  MediaEditRenderResult,
} from './mediaEditEngine.js';

export type MediaEditWorkerRequest =
  | ({ type: 'render'; id: number } & MediaEditRenderRequest)
  | ({ type: 'analyze'; id: number } & MediaEditRenderRequest)
  | ({ type: 'preview'; id: number } & MediaEditPreviewRequest)
  | ({ type: 'pauses'; id: number } & MediaEditPausesRequest)
  | { type: 'cancel'; id: number };

export type MediaEditWorkerResponse =
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'rendered'; id: number; result: MediaEditRenderResult }
  | { type: 'analyzed'; id: number; result: MediaFxAnalysis | null }
  | { type: 'previewed'; id: number; result: MediaEditPreviewResult }
  | { type: 'paused'; id: number; result: MediaEditPausesResult }
  | { type: 'error'; id: number; message: string; aborted: boolean };
