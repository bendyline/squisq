/**
 * Convenience wrapper around the version operations that captures a
 * {@link ContentContainer} reference and an optional basename override.
 *
 * Hosts that prefer a stable handle (e.g. to pass into a UI component)
 * use this; everything it does is also reachable as a free function.
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import {
  coalesceVersions,
  listVersions,
  pruneVersions,
  readVersion,
  revertToVersion,
  saveVersion,
} from './operations.js';
import type {
  CoalesceOptions,
  PrunePolicy,
  RevertOptions,
  SaveVersionOptions,
  SaveVersionResult,
  Version,
} from './types.js';

export interface DocumentVersionManagerOptions {
  /**
   * Override the document basename used in version filenames. Defaults to
   * the basename of `container.getDocumentPath()` resolved at call time.
   */
  basename?: string;
}

export class DocumentVersionManager {
  private readonly container: ContentContainer;
  private readonly basename: string | undefined;

  constructor(container: ContentContainer, options: DocumentVersionManagerOptions = {}) {
    this.container = container;
    this.basename = options.basename;
  }

  saveVersion(options: SaveVersionOptions = {}): Promise<SaveVersionResult> {
    return saveVersion(this.container, { basename: this.basename, ...options });
  }

  listVersions(): Promise<Version[]> {
    return listVersions(this.container, this.basename);
  }

  readVersion(version: Version | string): Promise<string | null> {
    return readVersion(this.container, version);
  }

  revertToVersion(
    version: Version | string,
    options?: RevertOptions,
  ): Promise<{ reverted: boolean; snapshotted: Version | null }> {
    return revertToVersion(this.container, version, options);
  }

  pruneVersions(policy: PrunePolicy): Promise<Version[]> {
    return pruneVersions(this.container, policy, this.basename);
  }

  coalesceVersions(options?: CoalesceOptions): Promise<Version[]> {
    return coalesceVersions(this.container, options, this.basename);
  }
}
