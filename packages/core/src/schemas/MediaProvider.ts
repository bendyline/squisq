/**
 * MediaProvider — abstract interface for resolving and managing media assets.
 *
 * Components (ImageLayer, VideoLayer, editor preview) use a MediaProvider to
 * resolve relative media paths to displayable URLs and to manage media storage.
 *
 * This decouples the rendering layer from the storage backend:
 * - In the dev site, a SlotStorage-backed provider serves blob URLs from IndexedDB
 * - In production, a simple basePath provider constructs CDN URLs
 * - In tests, a memory-backed provider returns data URIs
 */

/**
 * Metadata about a stored media asset.
 */
export interface MediaEntry {
  /** Filename (e.g., 'hero.jpg') */
  name: string;
  /** MIME type (e.g., 'image/jpeg') */
  mimeType: string;
  /** File size in bytes */
  size: number;
}

/**
 * Interface for resolving and managing media assets.
 *
 * All methods are async to support IndexedDB and other async storage backends.
 * The `resolveUrl` method is the primary integration point for rendering
 * components — it converts a relative media path into a displayable URL.
 */
export interface MediaProvider {
  /**
   * Resolve a relative media path to a displayable URL.
   *
   * Returns a URL that can be used in <img src>, <video src>, etc.
   * This may be a blob: URL, data: URL, or absolute HTTP URL depending
   * on the provider implementation.
   *
   * @param relativePath - Relative path as stored in the document (e.g., 'hero.jpg')
   * @returns Displayable URL, or the original path if resolution fails
   */
  resolveUrl(relativePath: string): Promise<string>;

  /**
   * List all media assets available in this provider's scope.
   */
  listMedia(): Promise<MediaEntry[]>;

  /**
   * Add a media asset. Returns the relative path to reference in documents.
   *
   * @param name - Filename for the asset (e.g., 'photo.jpg')
   * @param data - Binary content (ArrayBuffer, Blob, or Uint8Array)
   * @param mimeType - MIME type of the data
   * @returns The relative path to use in document references
   */
  addMedia(name: string, data: ArrayBuffer | Blob | Uint8Array, mimeType: string): Promise<string>;

  /**
   * Remove a media asset by its relative path.
   */
  removeMedia(relativePath: string): Promise<void>;

  /**
   * Dispose of any held resources (e.g., revoke blob URLs).
   * Call this when the provider is no longer needed.
   */
  dispose(): void;
}
