/**
 * Convenience wrapper around the image-edit version operations that
 * captures a {@link ContentContainer} reference and an optional basename
 * override. Mirrors `DocumentVersionManager` in shape.
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import type { CoalesceOptions, PrunePolicy, Version } from '../versions/types.js';
import {
  coalesceImageEditVersions,
  listImageEditVersions,
  pruneImageEditVersions,
  readImageEditVersion,
  revertToImageEditVersion,
  saveImageEditVersion,
  type RevertImageEditOptions,
  type SaveImageEditVersionOptions,
  type SaveImageEditVersionResult,
} from './versions.js';
import type { ImageEditDoc } from '../schemas/ImageEditDoc.js';

export interface ImageEditVersionManagerOptions {
  /** Override the basename used in version filenames. Defaults to `'state'`. */
  basename?: string;
  /** Override the source filename inside the sidecar. Defaults to `state.json`. */
  stateFilename?: string;
}

export class ImageEditVersionManager {
  private readonly container: ContentContainer;
  private readonly basename: string | undefined;
  private readonly stateFilename: string | undefined;

  constructor(container: ContentContainer, options: ImageEditVersionManagerOptions = {}) {
    this.container = container;
    this.basename = options.basename;
    this.stateFilename = options.stateFilename;
  }

  saveVersion(options: SaveImageEditVersionOptions = {}): Promise<SaveImageEditVersionResult> {
    return saveImageEditVersion(this.container, {
      basename: this.basename,
      stateFilename: this.stateFilename,
      ...options,
    });
  }

  listVersions(): Promise<Version[]> {
    return listImageEditVersions(this.container, this.basename);
  }

  readVersion(version: Version | string): Promise<ImageEditDoc | null> {
    return readImageEditVersion(this.container, version);
  }

  revertToVersion(
    version: Version | string,
    options: RevertImageEditOptions = {},
  ): Promise<{ reverted: boolean; snapshotted: Version | null }> {
    return revertToImageEditVersion(this.container, version, {
      stateFilename: this.stateFilename,
      ...options,
    });
  }

  pruneVersions(policy: PrunePolicy): Promise<Version[]> {
    return pruneImageEditVersions(this.container, policy, this.basename);
  }

  coalesceVersions(options: CoalesceOptions = {}): Promise<Version[]> {
    return coalesceImageEditVersions(this.container, options, this.basename);
  }
}
