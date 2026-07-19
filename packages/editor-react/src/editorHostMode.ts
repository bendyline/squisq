/**
 * Semantic embedding mode for the editor shell.
 *
 * The default document mode exposes the full multi-view authoring surface.
 * Chat mode keeps the composer in Write view and removes document-level
 * authoring controls that do not belong in a message composer.
 */
export type EditorHostMode = 'document' | 'chat';
