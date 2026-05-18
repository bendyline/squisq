/**
 * Document version history for Squisq.
 *
 * Snapshots of the primary markdown document live inside the same
 * {@link ContentContainer} at `.versions/<basename>.<timestamp>.md`.
 * Hosts call {@link DocumentVersionManager.saveVersion} (or the
 * underlying {@link saveVersion}) when they want to stamp a new version;
 * the editor's auto-save effect calls it on idle. Either way, snapshots
 * are written only when the document differs from the latest one.
 *
 * @example
 * ```ts
 * import { DocumentVersionManager } from '@bendyline/squisq/versions';
 *
 * const versioning = new DocumentVersionManager(container);
 * const result = await versioning.saveVersion();
 * if (result.saved) console.log('Stamped', result.version);
 *
 * const history = await versioning.listVersions();
 * await versioning.revertToVersion(history[0]);
 * await versioning.pruneVersions({ type: 'keep-last-n', n: 50 });
 * ```
 */

export type {
  Version,
  SaveVersionOptions,
  SaveVersionResult,
  PrunePolicy,
  RevertOptions,
  CoalesceOptions,
} from './types.js';

export {
  saveVersion,
  listVersions,
  readVersion,
  revertToVersion,
  pruneVersions,
  coalesceVersions,
} from './operations.js';

export {
  DocumentVersionManager,
  type DocumentVersionManagerOptions,
} from './DocumentVersionManager.js';

export {
  formatVersionTimestamp,
  parseVersionTimestamp,
  VERSION_TIMESTAMP_PATTERN,
} from './timestamp.js';

export { VERSIONS_PREFIX, getDocBasename, buildVersionPath, parseVersionPath } from './paths.js';
