import type { MediaClip } from '@bendyline/squisq/schemas';

/** Build the compact filename shown by timeline media surfaces. */
export function timelineMediaLabel(src: string, kind: MediaClip['kind']): string {
  const path = src.split(/[?#]/, 1)[0] ?? src;
  const base = path.split(/[\\/]/).pop() || path || src;
  if (kind !== 'video') return base;

  // Timeline video labels are already identified visually as video clips, so
  // the file extension adds noise without helping distinguish them.
  return base.replace(/\.[^.]+$/, '') || base;
}
