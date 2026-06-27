import type { ReactNode } from 'react';

/**
 * One entry in a {@link FolderView} — a file or subfolder. Host-defined
 * `path` is opaque to this component: it's used as the React key and
 * handed back verbatim to the open callbacks so the host can resolve it.
 */
export interface FolderEntry {
  /** Display name (basename). */
  name: string;
  /** Full host path. Opaque here; passed back on open. */
  path: string;
  isDirectory: boolean;
}

export interface FolderViewProps {
  /** Folder display name (basename) shown in the header. */
  name: string;
  /** Immediate children of the folder — subfolders and files. */
  entries: FolderEntry[];
  /** Open a file entry. The host decides what "open" means. */
  onOpenFile: (entry: FolderEntry) => void;
  /** Drill into a subfolder. */
  onOpenFolder: (entry: FolderEntry) => void;
  /** Primary action — create a new document in this folder. */
  onNewDocument: () => void;
  /** Secondary action — create a new subfolder. Omit to hide the button. */
  onNewFolder?: () => void;
  /** Color theme (default `'light'`). */
  theme?: 'light' | 'dark';
  /** CSS height for the container (default `'100%'`). */
  height?: string;
  /** Override the per-entry icon. Defaults to FontAwesome file/folder glyphs. */
  iconFor?: (entry: FolderEntry) => ReactNode;
}

/**
 * FolderView — a standalone folder browser surface.
 *
 * Lists a folder's files and subfolders plus a prominent "New document"
 * action (and an optional "New folder"). It's the companion to
 * {@link EditorShell}: where the shell edits a single document, this
 * presents the directory around it.
 *
 * Like the shell, it's host-agnostic — the consumer supplies the
 * `entries` and the open / new callbacks, and FolderView owns only the
 * presentation and theming. It holds no state and reads nothing from
 * disk, so it composes into any storage backend.
 */
export function FolderView({
  name,
  entries,
  onOpenFile,
  onOpenFolder,
  onNewDocument,
  onNewFolder,
  theme = 'light',
  height = '100%',
  iconFor = defaultIconFor,
}: FolderViewProps) {
  // Folders first, then files; each group alphabetical (case-insensitive).
  const sorted = [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return (
    <div className="squisq-folder-view" data-theme={theme} style={{ height }}>
      <div className="squisq-folder-view-header">
        <i className="fa-regular fa-folder-open squisq-folder-view-header-icon" aria-hidden="true" />
        <span className="squisq-folder-view-title">{name}</span>
        <span className="squisq-folder-view-count">
          {entries.length} {entries.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="squisq-folder-view-body">
        {sorted.length === 0 ? (
          <p className="squisq-folder-view-empty">This folder is empty.</p>
        ) : (
          <ul className="squisq-folder-view-list">
            {sorted.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="squisq-folder-view-item"
                  onClick={() => (entry.isDirectory ? onOpenFolder(entry) : onOpenFile(entry))}
                >
                  <span className="squisq-folder-view-item-icon">{iconFor(entry)}</span>
                  <span className="squisq-folder-view-item-name">{entry.name}</span>
                  {entry.isDirectory && (
                    <i
                      className="fa-solid fa-chevron-right squisq-folder-view-item-chevron"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="squisq-folder-view-actions">
        <button type="button" className="squisq-folder-view-new" onClick={onNewDocument}>
          <i className="fa-solid fa-plus" aria-hidden="true" /> New document
        </button>
        {onNewFolder && (
          <button
            type="button"
            className="squisq-folder-view-new-folder"
            onClick={onNewFolder}
          >
            <i className="fa-regular fa-folder" aria-hidden="true" /> New folder
          </button>
        )}
      </div>
    </div>
  );
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

function defaultIconFor(entry: FolderEntry): ReactNode {
  if (entry.isDirectory) {
    return <i className="fa-regular fa-folder fa-fw" aria-hidden="true" />;
  }
  if (IMAGE_RE.test(entry.name)) {
    return <i className="fa-regular fa-file-image fa-fw" aria-hidden="true" />;
  }
  return <i className="fa-regular fa-file-lines fa-fw" aria-hidden="true" />;
}
