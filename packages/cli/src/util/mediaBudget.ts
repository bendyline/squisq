/**
 * Media budget for the headless render path.
 *
 * `squisq video` base64-embeds every referenced image/audio/video asset into a
 * single render HTML document that is handed to the browser via
 * `page.setContent`. Base64 inflates bytes by ~4/3, and an oversized payload
 * fails deep inside the CDP transport with an opaque error rather than a
 * message the user can act on.
 *
 * The browser export path (`useVideoExport`) has enforced per-file / total /
 * count caps for exactly this reason; the CLI embedded without any cap. These
 * limits mirror the browser's so both paths refuse the same documents, and the
 * error names the offending asset.
 */

/** Matches `MAX_EXPORT_MEDIA_FILE_BYTES` in video-react's `useVideoExport`. */
export const MAX_RENDER_MEDIA_FILE_BYTES = 64 * 1024 * 1024;
/** Matches `MAX_EXPORT_MEDIA_TOTAL_BYTES` in video-react's `useVideoExport`. */
export const MAX_RENDER_MEDIA_TOTAL_BYTES = 256 * 1024 * 1024;
/** Matches `MAX_EXPORT_MEDIA_FILES` in video-react's `useVideoExport`. */
export const MAX_RENDER_MEDIA_FILES = 256;

export interface MediaBudget {
  /**
   * Admit one asset, or throw with an actionable message.
   *
   * @param path - Asset path, used in the error message.
   * @param data - Asset bytes.
   */
  admit(path: string, data: ArrayBuffer): void;
  /** Bytes admitted so far. */
  readonly totalBytes: number;
  /** Assets admitted so far. */
  readonly fileCount: number;
}

function mib(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Create a budget enforcing the render path's media caps. */
export function createMediaBudget(): MediaBudget {
  let totalBytes = 0;
  let fileCount = 0;

  return {
    get totalBytes() {
      return totalBytes;
    },
    get fileCount() {
      return fileCount;
    },
    admit(path: string, data: ArrayBuffer): void {
      if (data.byteLength > MAX_RENDER_MEDIA_FILE_BYTES) {
        throw new Error(
          `Media file "${path}" is ${mib(data.byteLength)}, which exceeds the ` +
            `${mib(MAX_RENDER_MEDIA_FILE_BYTES)} per-file limit for video rendering. ` +
            `Re-encode or shorten the asset.`,
        );
      }
      if (fileCount + 1 > MAX_RENDER_MEDIA_FILES) {
        throw new Error(
          `Document references more than ${MAX_RENDER_MEDIA_FILES} media files, which ` +
            `exceeds the limit for video rendering (adding "${path}").`,
        );
      }
      if (totalBytes + data.byteLength > MAX_RENDER_MEDIA_TOTAL_BYTES) {
        throw new Error(
          `Total embedded media exceeds the ${mib(MAX_RENDER_MEDIA_TOTAL_BYTES)} limit for ` +
            `video rendering (adding "${path}" would reach ` +
            `${mib(totalBytes + data.byteLength)}). Reduce the document's media.`,
        );
      }
      totalBytes += data.byteLength;
      fileCount += 1;
    },
  };
}
