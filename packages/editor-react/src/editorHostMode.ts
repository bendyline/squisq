/**
 * Semantic embedding mode for the editor shell.
 *
 * The default document mode exposes the full multi-view authoring surface.
 * Chat mode keeps the composer in Write view and removes document-level
 * authoring controls that do not belong in a message composer.
 */
export type EditorHostMode = 'document' | 'chat';

/**
 * Where the editor shell places its toolbar: above the editing surface (the
 * document default) or below it (a chat composer's attach and send row).
 */
export type EditorToolbarPosition = 'top' | 'bottom';
