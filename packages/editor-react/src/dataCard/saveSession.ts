import type { ContentContainer } from '@bendyline/squisq/storage';
import type { MediaProvider } from '@bendyline/squisq/schemas';

interface FileSaveSession {
  tail: Promise<unknown>;
  bytes?: ArrayBuffer;
}

const sessions = new WeakMap<object, Map<string, FileSaveSession>>();

/** Serialize saves to one file and merge region edits into the latest bytes. */
export function withDataSave<T extends { ok: boolean; bytes?: ArrayBuffer }>(
  options: {
    path: string;
    originalBytes: ArrayBuffer;
    container: ContentContainer | null;
    mediaProvider: MediaProvider;
  },
  save: (baseline: ArrayBuffer) => Promise<T>,
): Promise<T> {
  const owner = options.container ?? options.mediaProvider;
  let files = sessions.get(owner);
  if (!files) {
    files = new Map();
    sessions.set(owner, files);
  }
  let session = files.get(options.path);
  if (!session) {
    session = { tail: Promise.resolve() };
    files.set(options.path, session);
  }
  const current = session;
  const result = current.tail
    .catch(() => undefined)
    .then(async () => {
      let latest = await options.container?.readFile(options.path);
      if (!latest && !options.container) {
        const url = await options.mediaProvider.resolveUrl(options.path);
        if (url !== options.path) {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(`Could not read the current file before saving (${response.status})`);
          latest = await response.arrayBuffer();
        }
      }
      const baseline = latest ?? current.bytes ?? options.originalBytes;
      const saved = await save(baseline);
      if (saved.ok && saved.bytes) current.bytes = saved.bytes;
      return saved;
    });
  current.tail = result;
  return result;
}
