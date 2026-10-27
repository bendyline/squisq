/**
 * Narration timing runs that outlive the tray.
 *
 * Transcribing a long take takes minutes, so a run lives in a module-level
 * store keyed by container and media path: it survives the tray (or the
 * Write view) unmounting and shows its progress again when it comes back.
 * The pipeline itself loads only when a run starts.
 */

import type { ContentContainer } from '@bendyline/squisq/storage';
import type {
  NarrationTimingProgress,
  NarrationTimingResult,
  NarrationTimingsFromAudioInput,
} from './narrationTimingsFromAudio';

export type NarrationTimingJobState =
  | { status: 'running'; progress: NarrationTimingProgress }
  | { status: 'done'; result: NarrationTimingResult }
  | { status: 'error'; message: string };

interface Job {
  state: NarrationTimingJobState;
  abort: AbortController;
}

const jobsByContainer = new WeakMap<ContentContainer, Map<string, Job>>();
const listeners = new Set<() => void>();

function jobsFor(container: ContentContainer): Map<string, Job> {
  let jobs = jobsByContainer.get(container);
  if (!jobs) {
    jobs = new Map();
    jobsByContainer.set(container, jobs);
  }
  return jobs;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeNarrationTimingJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function narrationTimingJob(
  container: ContentContainer,
  src: string,
): NarrationTimingJobState | null {
  return jobsByContainer.get(container)?.get(src)?.state ?? null;
}

/** Start a run unless one is already going for this take. `onSaved` follows a successful write. */
export function startNarrationTimingJob(
  input: Omit<NarrationTimingsFromAudioInput, 'signal' | 'onProgress'> & { onSaved?: () => void },
): void {
  const jobs = jobsFor(input.container);
  if (jobs.get(input.src)?.state.status === 'running') return;
  const job: Job = {
    state: { status: 'running', progress: { phase: 'reading', fraction: 0 } },
    abort: new AbortController(),
  };
  jobs.set(input.src, job);
  notify();
  const settle = (state: NarrationTimingJobState | null) => {
    if (jobs.get(input.src) !== job) return;
    if (state) job.state = state;
    else jobs.delete(input.src);
    notify();
  };
  import('./narrationTimingsFromAudio')
    .then(({ updateNarrationTimingsFromAudio }) =>
      updateNarrationTimingsFromAudio({
        ...input,
        signal: job.abort.signal,
        onProgress: (progress) => settle({ status: 'running', progress }),
      }),
    )
    .then(
      (result) => {
        settle({ status: 'done', result });
        input.onSaved?.();
      },
      (caught: unknown) => {
        if (job.abort.signal.aborted) settle(null);
        else
          settle({
            status: 'error',
            message: caught instanceof Error ? caught.message : String(caught),
          });
      },
    );
}

export function cancelNarrationTimingJob(container: ContentContainer, src: string): void {
  jobsByContainer.get(container)?.get(src)?.abort.abort();
}
