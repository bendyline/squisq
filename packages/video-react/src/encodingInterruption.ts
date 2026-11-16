/**
 * The encoder lost its codec with submitted frames whose output never reached
 * the MP4. A replacement codec is already running; submit frames again
 * starting at {@link resumeFrom}. Everything before it is safely in the MP4.
 */
export class VideoEncodingInterruptedError extends Error {
  readonly resumeFrom: number;

  constructor(resumeFrom: number) {
    super(`Video encoding was interrupted; encoding resumes at frame ${resumeFrom + 1}.`);
    this.name = 'VideoEncodingInterruptedError';
    this.resumeFrom = resumeFrom;
  }
}
