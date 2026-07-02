/**
 * Render-style post-pass — applies a theme's mechanical motion defaults to
 * template-generated layers.
 *
 * This is the intent-free half of theme motion (see `themedEntrance` in
 * [themeUtils.ts](./themeUtils.ts) for the intent-bearing half): it never
 * decides *what kind* of entrance a layer gets, only
 *
 *  1. scales existing animation durations/delays by the theme's
 *     `style.animationSpeed` multiplier (1.4 = calmer/slower, 0.7 = snappier,
 *     1.0 = no-op), and
 *  2. gives full-bleed cover imagery with no authored animation a gentle,
 *     deterministic Ken Burns when the theme opts into ambient motion.
 *
 * Applied ONLY to template-generated layers — raw authored `block.layers`
 * are never touched, and an explicit `animation` (including
 * `{ type: 'none' }`) always wins.
 */

import type { Layer, Animation } from '../../schemas/Doc.js';
import type { Theme } from '../../schemas/Theme.js';
import { SeededRandom, hashString } from '../../random/index.js';

/** The gentle Ken Burns variants ambient motion rotates between. */
const AMBIENT_VARIANTS: readonly Animation[] = [
  { type: 'slowZoom', direction: 'in' },
  { type: 'slowZoom', direction: 'out' },
  { type: 'slowZoom', panDirection: 'left' },
  { type: 'slowZoom', panDirection: 'right' },
];

/** Minimum ambient Ken Burns duration — short blocks shouldn't rush the pan. */
const MIN_AMBIENT_DURATION_SECONDS = 8;

function isZeroish(v: number | string | undefined): boolean {
  return v === 0 || v === '0' || v === '0%';
}

/**
 * Full-bleed cover imagery is the only shape we can safely blanket-animate:
 * anything smaller (strips, insets, grid cells) was placed deliberately and
 * a zoom would fight the composition.
 */
function isFullBleedCoverMedia(layer: Layer): boolean {
  if (layer.type !== 'image' && layer.type !== 'video') return false;
  const { position } = layer;
  if (!isZeroish(position.x) || !isZeroish(position.y)) return false;
  if (position.width !== '100%' || position.height !== '100%') return false;
  const fit = (layer.content as { fit?: string }).fit;
  return fit === undefined || fit === 'cover';
}

/**
 * Whether the theme asks for ambient Ken Burns on otherwise-static imagery.
 * `defaultImageAnimation: 'slowZoom'` is treated as an alias for the boolean
 * (that's what themes authoring it were reaching for).
 */
export function themeWantsAmbientMotion(theme: Theme): boolean {
  return (
    theme.renderStyle.ambientMotion === true ||
    theme.renderStyle.defaultImageAnimation === 'slowZoom'
  );
}

/**
 * Apply the theme's mechanical motion defaults to a block's
 * template-generated layers. Pure: returns new layer objects where a change
 * applies and the original objects where none does.
 *
 * @param layers Template-generated layers (never raw authored layers)
 * @param block  The source block — supplies the ambient-motion seed and duration
 * @param theme  Resolved theme
 */
export function applyRenderStyleToLayers(
  layers: Layer[],
  block: { id: string; duration?: number },
  theme: Theme,
): Layer[] {
  const speed = theme.style.animationSpeed ?? 1.0;
  const ambient = themeWantsAmbientMotion(theme);
  if (speed === 1.0 && !ambient) return layers;

  return layers.map((layer) => {
    let animation = layer.animation;

    // Ambient Ken Burns for full-bleed cover imagery with no authored
    // animation. Deterministic per block+layer so re-renders, export
    // frames, and screenshots always agree.
    if (!animation && ambient && isFullBleedCoverMedia(layer)) {
      const rng = new SeededRandom(hashString(`${block.id}:${layer.id}`));
      const variant = rng.pickRequired(AMBIENT_VARIANTS as Animation[]);
      animation = {
        ...variant,
        duration: Math.max(MIN_AMBIENT_DURATION_SECONDS, block.duration ?? 0),
      };
    }

    if (!animation || animation.type === 'none') {
      return animation === layer.animation ? layer : { ...layer, animation };
    }

    // Speed scaling — single site so templates never double-scale.
    if (speed !== 1.0) {
      animation = {
        ...animation,
        ...(animation.duration != null ? { duration: animation.duration * speed } : {}),
        ...(animation.delay != null ? { delay: animation.delay * speed } : {}),
      };
    }

    return animation === layer.animation ? layer : { ...layer, animation };
  });
}
