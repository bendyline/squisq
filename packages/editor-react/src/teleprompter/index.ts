/**
 * Narrate (teleprompter) display mode — public surface.
 */

export {
  TeleprompterView,
  type TeleprompterViewProps,
  type TeleprompterRecordingDeps,
} from './TeleprompterView';
export {
  useNarrationRecorder,
  type NarrationRecorderController,
  type NarrationRecorderState,
  type NarrationTake,
} from './recording/useNarrationRecorder';
export {
  buildNarrationSavePlan,
  executeNarrationSave,
  type NarrationSavePlan,
  type NarrationSaveResult,
} from './recording/narrationSave';
export {
  insertNarrationPreamble,
  narrationAnnotationLine,
  cameraVideoLine,
} from './recording/insertPreamble';
export { TeleprompterSurface, type TeleprompterSurfaceProps } from './TeleprompterSurface';
export { TeleprompterControls, type TeleprompterControlsProps } from './TeleprompterControls';
export {
  useTeleprompter,
  vadConfigForSensitivity,
  type TeleprompterController,
} from './useTeleprompter';
export { useMicAnalysis, type MicAnalysisHandle, type MicAnalysisStatus } from './useMicAnalysis';
export { PCM_WORKLET_SOURCE, PCM_WORKLET_NAME, registerPcmWorklet } from './pcmWorklet';
export {
  createFloatingWindowManager,
  detectFloatTiers,
  type FloatingWindowManager,
  type FloatOpenOptions,
  type CanvasSink,
} from './floatingWindow';
export { useFloatingWindow, type FloatingWindowHandle } from './useFloatingWindow';
export {
  measureTokenLines,
  targetOffsetFor,
  stepScroll,
  EYE_LINE_FRACTION,
  type TokenLineMap,
} from './scrollModel';
export {
  TELEPROMPTER_CSS,
  ensureTeleprompterStyles,
  prompterVarsFromTheme,
} from './teleprompterTheme';
export {
  DEFAULT_TELEPROMPTER_PREFS,
  type TeleprompterPrefs,
  type PrompterTransport,
  type FloatTier,
} from './types';
