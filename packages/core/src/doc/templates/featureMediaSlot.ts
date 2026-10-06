import type { Position } from '../../schemas/Doc.js';

/** Shared primary-media geometry for images and embedded feature visuals. */
export function featureMediaSlot(
  side: 'left' | 'right',
  {
    stack,
    summaryFeature,
    sized = false,
  }: {
    stack: boolean;
    summaryFeature: boolean;
    sized?: boolean;
  },
): { position: Position; fit: 'cover' | 'contain' } {
  if (summaryFeature) {
    // Title-only slides give the visual the unused body space without cropping.
    return {
      position: {
        x: stack ? '5%' : side === 'left' ? '5%' : '35%',
        y: '5%',
        width: stack ? '90%' : '60%',
        height: stack ? '70%' : '90%',
      },
      fit: 'contain',
    };
  }
  if (stack) {
    return {
      position: { x: '0', y: '0', width: '100%', height: '50%' },
      fit: sized ? 'contain' : 'cover',
    };
  }
  if (sized) {
    // Authored image dimensions cue a padded, contained visual in its half.
    return {
      position: { x: side === 'left' ? '5%' : '55%', y: '5%', width: '40%', height: '90%' },
      fit: 'contain',
    };
  }
  return {
    position: { x: side === 'left' ? '0' : '50%', y: '0', width: '50%', height: '100%' },
    fit: 'cover',
  };
}
