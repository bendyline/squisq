export { calculateSegmentTiming, findSegmentAtTime } from './AudioController';
export type {
  AudioState,
  AudioActions,
  AudioController,
  AudioControllerConfig,
} from './AudioController';

export { useAudioSync } from './useAudioSync';
export { useModalDialog } from './useModalDialog';
export type { ModalDialogOptions } from './useModalDialog';
export {
  MediaContext,
  ResourcePolicyContext,
  useMediaProvider,
  useResourcePolicy,
  useMediaUrl,
} from './MediaContext';
export { useDocPlayback } from './useDocPlayback';
export { useViewportOrientation } from './useViewportOrientation';
