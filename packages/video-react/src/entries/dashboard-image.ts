/**
 * `@bendyline/squisq-video-react/dashboard-image` — the dashboard image
 * export dialog and its option vocabulary, isolated from the MP4/GIF
 * encoder worker graph (the same split `/cover-image` provides) so editor
 * surfaces can offer image export without pulling in encoding code.
 */
export { DashboardImageExportModal } from '../DashboardImageExportModal';
export type {
  DashboardImageExportFormat,
  DashboardImageExportModalProps,
} from '../DashboardImageExportModal';
export {
  DASHBOARD_RESOLUTIONS,
  DEFAULT_DASHBOARD_RESOLUTION,
  validateDashboardImageDimensions,
} from '@bendyline/squisq-video';
export type { DashboardResolutionId, DashboardResolutionPreset } from '@bendyline/squisq-video';
