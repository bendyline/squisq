/**
 * Icons barrel — subpath `@bendyline/squisq/icons`.
 *
 * Exposes the FontAwesome Free catalog (`ICONS`, `IconEntry`,
 * `IconFamily`) and the lookup helpers (`resolveIcon`,
 * `canonicalIconToken`, `looksLikeIconToken`).
 */

export { ICONS } from './iconData.js';
export type { IconEntry, IconFamily } from './iconData.js';
export {
  resolveIcon,
  canonicalIconToken,
  looksLikeIconToken,
  suggestIcons,
  iconGlyph,
} from './resolve.js';
export type { IconSuggestion } from './resolve.js';
