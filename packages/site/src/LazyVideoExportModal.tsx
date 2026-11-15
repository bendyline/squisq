/**
 * LazyVideoExportModal — `VideoExportModal`, fetched the first time the site
 * opens it.
 *
 * The modal statically reaches the whole browser export pipeline — the frame
 * capture hook, the WebCodecs encoder and its H.264 probe, the audio mix and
 * the GIF transcode — none of which a visitor needs until they choose to
 * export a video. Importing it directly put all of that in the startup
 * payload (`e2e/startup-performance.spec.ts` holds the budget).
 */

import { lazy, Suspense, type ComponentProps } from 'react';
import type { VideoExportModal as VideoExportModalComponent } from '@bendyline/squisq-video-react';

const VideoExportModal = lazy(() =>
  import('@bendyline/squisq-video-react').then((module) => ({
    default: module.VideoExportModal,
  })),
);

export function LazyVideoExportModal(props: ComponentProps<typeof VideoExportModalComponent>) {
  return (
    <Suspense fallback={null}>
      <VideoExportModal {...props} />
    </Suspense>
  );
}
