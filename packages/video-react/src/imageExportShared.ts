/**
 * Shared single-frame image-export helpers used by both raster export
 * dialogs (CoverImageExportModal, DashboardImageExportModal): format
 * metadata, canvas encoding, the File System Access save flow, and the
 * download fallback. Pure module-level functions with no component state.
 */

export type ImageExportFormat = 'png' | 'jpeg' | 'webp';

export const IMAGE_FORMAT_DETAILS: Record<
  ImageExportFormat,
  { extension: string; mime: string; label: string }
> = {
  png: { extension: 'png', mime: 'image/png', label: 'PNG — lossless' },
  jpeg: { extension: 'jpg', mime: 'image/jpeg', label: 'JPEG — smaller file' },
  webp: { extension: 'webp', mime: 'image/webp', label: 'WebP — compact' },
};

export interface ImageExportWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface ImageExportFileHandle {
  createWritable(): Promise<ImageExportWritable>;
}

interface ImageExportPickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<ImageExportFileHandle>;
}

/**
 * Sanitize a requested file name into `<base>-<suffix>.<ext>` — strips any
 * extension, replaces characters Windows rejects, drops control characters
 * and trailing dots/spaces, and falls back to `document`.
 */
export function imageExportFilename(
  requestedName: string | undefined,
  suffix: string,
  format: ImageExportFormat,
): string {
  const extension = IMAGE_FORMAT_DETAILS[format].extension;
  const base =
    requestedName
      ?.replace(/\.[^.]+$/, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .split('')
      .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .join('')
      .trim()
      .replace(/[. ]+$/g, '') || 'document';
  return `${base}-${suffix}.${extension}`;
}

/** Encode a rendered canvas into the chosen format. */
export function canvasToImageBlob(
  canvas: HTMLCanvasElement,
  format: ImageExportFormat,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not encode the image.'));
      },
      IMAGE_FORMAT_DETAILS[format].mime,
      format === 'png' ? undefined : quality,
    );
  });
}

/**
 * Ask for a save target via the File System Access API. Returns undefined
 * when the API is unavailable (caller falls back to a download), and null
 * when the user cancelled the picker.
 */
export async function chooseImageSaveTarget(
  filename: string,
  format: ImageExportFormat,
): Promise<ImageExportFileHandle | null | undefined> {
  const picker = (window as unknown as ImageExportPickerWindow).showSaveFilePicker;
  if (!picker) return undefined;
  const details = IMAGE_FORMAT_DETAILS[format];
  try {
    return await picker.call(window, {
      suggestedName: filename,
      types: [
        {
          description: `${details.label.split(' —')[0]} image`,
          accept: { [details.mime]: [`.${details.extension}`] },
        },
      ],
    });
  } catch (caught: unknown) {
    if (caught instanceof DOMException && caught.name === 'AbortError') return null;
    throw caught;
  }
}

/** Anchor-click download fallback for browsers without the FS Access API. */
export function downloadImageBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
