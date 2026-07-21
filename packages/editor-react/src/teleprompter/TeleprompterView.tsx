/**
 * TeleprompterView — the Narrate display-mode root mounted by
 * PreviewPanel. A thin composition of useNarrationStage (controller +
 * recorder + save orchestration) and NarrationStage (surface, portals,
 * review bar, control rail). The Record media dialog mounts the same two
 * pieces directly; keep this wrapper API-stable.
 *
 * Recording (scenario 1) is prop-gated: PreviewPanel passes
 * `recording` deps (media provider + markdown writers) when the host
 * allows it; without them this is a pure prompter (scenario 2) with
 * zero capture code paths.
 */

import type { Doc, Theme } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useNarrationStage, type TeleprompterRecordingDeps } from './useNarrationStage';
import { NarrationStage } from './NarrationStage';

export type { TeleprompterRecordingDeps } from './useNarrationStage';

export interface TeleprompterViewProps {
  doc: Doc | null;
  theme: Theme;
  /** Kept for API symmetry with PreviewPanel; recording uses `recording.container`. */
  workspaceContainer?: ContentContainer | null;
  /** Media base path (reserved for future preview integrations). */
  basePath?: string;
  /**
   * Optional audience-window portal owned by the editor's Presentation mode.
   * The main controller remains authoritative; only this live surface is
   * mirrored into the target.
   */
  presentationTarget?: HTMLElement | null;
  /** Recording deps; null/omitted disables the Record affordance. */
  recording?: TeleprompterRecordingDeps | null;
}

export function TeleprompterView(props: TeleprompterViewProps) {
  const { doc, theme, presentationTarget = null, recording = null } = props;
  const stage = useNarrationStage({ doc, recording });
  return <NarrationStage stage={stage} theme={theme} presentationTarget={presentationTarget} />;
}
