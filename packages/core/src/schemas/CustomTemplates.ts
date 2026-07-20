/**
 * Custom Templates Schema
 *
 * User-defined block layout templates. The author designs a visual
 * layout once (in the editor's TemplateDesigner) and saves it as a
 * `CustomTemplateDefinition`. The definition lives either in the
 * document's frontmatter (per-doc, portable, ships with the markdown)
 * or in the user's local library (cross-doc reuse via localStorage).
 *
 * A custom template's content is just a `Layer[]` — the same shape that
 * built-in templates emit at expansion time. The novel bit is
 * *placeholder tokens*: TextLayer / ImageLayer content fields may carry
 * strings like `{title}`, `{content}`, `{children}`, or `{image:N}`
 * that the resolver (see `doc/templates/tokens/resolveTokens.ts`)
 * substitutes against the source Block at render time.
 *
 * Responsiveness model: every numeric position field in `layers` is
 * stored as a `%`-string relative to `viewport`, so the same template
 * renders correctly at any of Squisq's viewport presets (landscape,
 * portrait, square). The `viewport` field itself is purely an
 * authoring-time reference — it tells the designer canvas which aspect
 * ratio to mount with, and the thumbnail renderer which viewBox to use.
 */

import type { Layer } from './Doc.js';

/**
 * Iteration directive for a custom-template layer.
 *
 * A layer that carries a `repeat` is cloned once per item of a source
 * collection at render time (see `resolveTokens`). The clones are laid
 * out in a row or column, offset from the base position by the layer's
 * own width/height plus `gap`, and each clone resolves per-item tokens
 * (`{item}`, `{item:src}`, `{item:label}`, `{index}`) against its item.
 */
export interface LayerRepeat {
  /**
   * Which of the source Block's collections to iterate:
   *   - `images`    — every image in the block body (alt + url)
   *   - `children`  — child block titles
   *   - `listItems` — top-level list-item text in the block body
   */
  source: 'images' | 'children' | 'listItems';

  /**
   * Layout axis for the clones. `column` (default) stacks them
   * vertically (offsets `position.y`); `row` lays them out horizontally
   * (offsets `position.x`).
   */
  direction?: 'row' | 'column';

  /**
   * Extra spacing added between consecutive clones, in the same unit as
   * the layer's `width`/`height`. Defaults to 24.
   */
  gap?: number;

  /** Cap on the number of clones rendered (omit for "all items"). */
  max?: number;
}

/**
 * A custom-template layer: a normal render `Layer` that may additionally
 * carry a `repeat` directive. This is a strict superset of the core
 * `Layer` type used only inside `CustomTemplateDefinition.layers`; the
 * resolver strips `repeat` before emitting the final `Layer[]`, so the
 * core `Layer` type is never widened.
 */
export type CustomTemplateLayer = Layer & { repeat?: LayerRepeat };

/**
 * A single user-defined template. Stored in `Doc.customTemplates`
 * (frontmatter-backed) or in the user's local library.
 */
export interface CustomTemplateDefinition {
  /**
   * Stable id used in heading annotations (`### Foo {[name]}`). Must be
   * a slug — lowercase alphanumerics, hyphens. The picker enforces
   * uniqueness within a (doc + library) merged namespace.
   */
  name: string;

  /** Human-readable label shown in the template picker. */
  label: string;

  /** Optional one-sentence description for the picker card. */
  description?: string;

  /**
   * Authoring viewport — the canvas size the designer drew against.
   * Stored so the designer and thumbnail renderer can reproduce the
   * same canvas. Layer positions are stored as `%`-strings, so the
   * actual render-time viewport can differ from this without breaking
   * the layout. Defaults to 1920×1080 landscape.
   */
  viewport: {
    width: number;
    height: number;
  };

  /**
   * The visual content. Every `position.x` / `position.y` /
   * `position.width` / `position.height` should be a `%`-string at
   * save time (the designer's normalizePositions step enforces this).
   *
   * Tokens supported (grammar v2):
   *   - TextLayer.content.text — `{title}`, `{content}`, `{children}`,
   *     `{image:N}` (Nth image's alt text), `{attr:key}` (block
   *     attribute), plus a pipe default on any token
   *     (`{attr:subtitle|Untitled}`).
   *   - ImageLayer.content.src — `{image:N}` (the URL) and `{attr:key}`,
   *     with pipe defaults (`{image:1|fallback.jpg}`).
   *   - Inside a layer with `repeat`, per-item tokens: `{item}`,
   *     `{item:src}`, `{item:label}`, `{index}` (1-based).
   *
   * A layer may carry a `repeat` directive (see {@link LayerRepeat}) to
   * be cloned once per item of a source collection.
   */
  layers: CustomTemplateLayer[];
}

/** A structural problem found while decoding a custom template. */
export interface CustomTemplateValidationError {
  /** JSON-style path to the invalid value. */
  path: string;
  /** Human-readable description of the required shape. */
  message: string;
}

/** Result returned by {@link validateCustomTemplateDefinition}. */
export interface CustomTemplateValidationResult {
  valid: boolean;
  errors: CustomTemplateValidationError[];
  /** Present only when the complete input is structurally valid. */
  template?: CustomTemplateDefinition;
}

const LAYER_TYPES = new Set([
  'image',
  'text',
  'shape',
  'path',
  'map',
  'video',
  'table',
  'tree',
  'mermaid',
]);
const ANIMATION_TYPES = new Set([
  'none',
  'fadeIn',
  'fadeOut',
  'slowZoom',
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
  'typewriter',
]);

class TemplateValidator {
  readonly errors: CustomTemplateValidationError[] = [];

  error(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  object(value: unknown, path: string): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.error(path, 'expected object');
      return false;
    }
    return true;
  }

  string(value: unknown, path: string, nonEmpty = false): value is string {
    if (typeof value !== 'string' || (nonEmpty && value.trim().length === 0)) {
      this.error(path, nonEmpty ? 'expected non-empty string' : 'expected string');
      return false;
    }
    return true;
  }

  number(value: unknown, path: string): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.error(path, 'expected finite number');
      return false;
    }
    return true;
  }

  boolean(value: unknown, path: string): value is boolean {
    if (typeof value !== 'boolean') {
      this.error(path, 'expected boolean');
      return false;
    }
    return true;
  }

  enum(value: unknown, path: string, allowed: ReadonlySet<string>): value is string {
    if (typeof value !== 'string' || !allowed.has(value)) {
      this.error(path, `expected one of: ${Array.from(allowed).join(', ')}`);
      return false;
    }
    return true;
  }
}

function optionalString(
  v: TemplateValidator,
  obj: Record<string, unknown>,
  key: string,
  path: string,
) {
  if (obj[key] !== undefined) v.string(obj[key], `${path}.${key}`);
}

function optionalNumber(
  v: TemplateValidator,
  obj: Record<string, unknown>,
  key: string,
  path: string,
) {
  if (obj[key] !== undefined) v.number(obj[key], `${path}.${key}`);
}

function optionalBoolean(
  v: TemplateValidator,
  obj: Record<string, unknown>,
  key: string,
  path: string,
) {
  if (obj[key] !== undefined) v.boolean(obj[key], `${path}.${key}`);
}

function optionalEnum(
  v: TemplateValidator,
  obj: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly string[],
) {
  if (obj[key] !== undefined) v.enum(obj[key], `${path}.${key}`, new Set(allowed));
}

function validatePosition(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  for (const key of ['x', 'y'] as const) validateCoordinate(v, value[key], `${path}.${key}`);
  for (const key of ['width', 'height'] as const) {
    if (value[key] !== undefined) validateCoordinate(v, value[key], `${path}.${key}`);
  }
  optionalEnum(v, value, 'anchor', path, [
    'center',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ]);
}

function validateCoordinate(v: TemplateValidator, value: unknown, path: string): void {
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && Number.isFinite(Number.parseFloat(value))) return;
  v.error(path, 'expected finite number or numeric string');
}

function validateAnimation(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.enum(value.type, `${path}.type`, ANIMATION_TYPES);
  optionalNumber(v, value, 'duration', path);
  optionalNumber(v, value, 'delay', path);
  optionalString(v, value, 'easing', path);
  optionalEnum(v, value, 'direction', path, ['in', 'out']);
  optionalEnum(v, value, 'panDirection', path, ['left', 'right', 'up', 'down']);
}

function validateRepeat(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.enum(value.source, `${path}.source`, new Set(['images', 'children', 'listItems']));
  optionalEnum(v, value, 'direction', path, ['row', 'column']);
  optionalNumber(v, value, 'gap', path);
  if (value.max !== undefined && v.number(value.max, `${path}.max`)) {
    if (!Number.isInteger(value.max) || value.max < 0) {
      v.error(`${path}.max`, 'expected non-negative integer');
    }
  }
}

function validateGradient(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.string(value.from, `${path}.from`);
  v.string(value.to, `${path}.to`);
  optionalNumber(v, value, 'angle', path);
}

function validateTextStyle(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.number(value.fontSize, `${path}.fontSize`);
  v.string(value.color, `${path}.color`);
  optionalString(v, value, 'fontFamily', path);
  optionalEnum(v, value, 'fontWeight', path, ['normal', 'bold']);
  optionalEnum(v, value, 'fontStyle', path, ['normal', 'italic']);
  optionalEnum(v, value, 'textAlign', path, ['left', 'center', 'right']);
  optionalEnum(v, value, 'verticalAlign', path, ['top', 'middle', 'bottom']);
  optionalNumber(v, value, 'lineHeight', path);
  optionalBoolean(v, value, 'shadow', path);
  optionalString(v, value, 'background', path);
  optionalNumber(v, value, 'backgroundOpacity', path);
  if (value.backgroundGradient !== undefined) {
    validateGradient(v, value.backgroundGradient, `${path}.backgroundGradient`);
  }
  optionalString(v, value, 'borderColor', path);
  optionalNumber(v, value, 'borderWidth', path);
  optionalEnum(v, value, 'borderStyle', path, ['solid', 'dashed', 'dotted']);
  optionalNumber(v, value, 'padding', path);
  optionalNumber(v, value, 'maxLines', path);
}

function validateImageContent(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.string(value.src, `${path}.src`);
  v.string(value.alt, `${path}.alt`);
  optionalEnum(v, value, 'fit', path, ['cover', 'contain', 'fill']);
  optionalString(v, value, 'credit', path);
  optionalString(v, value, 'license', path);
  optionalNumber(v, value, 'blur', path);
  if (value.treatment !== undefined) {
    const treatmentPath = `${path}.treatment`;
    if (v.object(value.treatment, treatmentPath)) {
      v.enum(
        value.treatment.type,
        `${treatmentPath}.type`,
        new Set(['none', 'mono', 'duotone', 'warm', 'cool']),
      );
      optionalNumber(v, value.treatment, 'strength', treatmentPath);
      optionalString(v, value.treatment, 'color', treatmentPath);
    }
  }
}

function validateShapeContent(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.enum(value.shape, `${path}.shape`, new Set(['rect', 'circle', 'line']));
  optionalString(v, value, 'fill', path);
  optionalNumber(v, value, 'fillOpacity', path);
  if (value.gradient !== undefined) validateGradient(v, value.gradient, `${path}.gradient`);
  optionalString(v, value, 'stroke', path);
  optionalNumber(v, value, 'strokeWidth', path);
  optionalEnum(v, value, 'borderStyle', path, ['solid', 'dashed', 'dotted']);
  optionalNumber(v, value, 'borderRadius', path);
  if (value.pattern !== undefined) {
    const patternPath = `${path}.pattern`;
    if (v.object(value.pattern, patternPath)) {
      v.enum(value.pattern.kind, `${patternPath}.kind`, new Set(['dots', 'grid', 'diagonal']));
      v.string(value.pattern.color, `${patternPath}.color`);
      optionalNumber(v, value.pattern, 'size', patternPath);
      optionalNumber(v, value.pattern, 'opacity', patternPath);
    }
  }
  if (value.filter !== undefined) {
    const filterPath = `${path}.filter`;
    if (v.object(value.filter, filterPath)) {
      v.enum(value.filter.type, `${filterPath}.type`, new Set(['noise']));
      optionalNumber(v, value.filter, 'baseFrequency', filterPath);
      optionalNumber(v, value.filter, 'opacity', filterPath);
    }
  }
}

function validatePathContent(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.string(value.d, `${path}.d`);
  optionalString(v, value, 'shapeKind', path);
  optionalString(v, value, 'stroke', path);
  optionalNumber(v, value, 'strokeWidth', path);
  optionalString(v, value, 'fill', path);
  optionalNumber(v, value, 'fillOpacity', path);
  if (value.gradient !== undefined) validateGradient(v, value.gradient, `${path}.gradient`);
  optionalEnum(v, value, 'borderStyle', path, ['solid', 'dashed', 'dotted']);
  optionalString(v, value, 'dasharray', path);
  const markers = ['none', 'arrow', 'open', 'diamond', 'circle', 'square'];
  optionalEnum(v, value, 'startMarker', path, markers);
  optionalEnum(v, value, 'endMarker', path, markers);
}

function validateMapContent(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  if (v.object(value.center, `${path}.center`)) {
    v.number(value.center.lat, `${path}.center.lat`);
    v.number(value.center.lng, `${path}.center.lng`);
  }
  v.number(value.zoom, `${path}.zoom`);
  v.enum(
    value.style,
    `${path}.style`,
    new Set(['terrain', 'satellite', 'road', 'toner', 'watercolor']),
  );
  optionalString(v, value, 'staticSrc', path);
  optionalBoolean(v, value, 'showAttribution', path);
  if (value.markers !== undefined) {
    if (!Array.isArray(value.markers)) {
      v.error(`${path}.markers`, 'expected array');
    } else {
      value.markers.forEach((marker, index) => {
        const markerPath = `${path}.markers[${index}]`;
        if (!v.object(marker, markerPath)) return;
        v.number(marker.lat, `${markerPath}.lat`);
        v.number(marker.lng, `${markerPath}.lng`);
        optionalString(v, marker, 'label', markerPath);
        optionalString(v, marker, 'color', markerPath);
        optionalEnum(v, marker, 'icon', markerPath, ['pin', 'circle', 'star']);
      });
    }
  }
}

function validateVideoContent(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.string(value.src, `${path}.src`);
  v.string(value.alt, `${path}.alt`);
  v.number(value.clipStart, `${path}.clipStart`);
  v.number(value.clipEnd, `${path}.clipEnd`);
  optionalString(v, value, 'posterSrc', path);
  optionalEnum(v, value, 'fit', path, ['cover', 'contain', 'fill']);
  optionalNumber(v, value, 'sourceDuration', path);
  optionalNumber(v, value, 'startAt', path);
  optionalBoolean(v, value, 'spillover', path);
  optionalString(v, value, 'credit', path);
  optionalString(v, value, 'license', path);
}

function validateTableContent(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  validateStringArray(v, value.headers, `${path}.headers`);
  if (!Array.isArray(value.rows)) {
    v.error(`${path}.rows`, 'expected array');
  } else {
    value.rows.forEach((row, index) => validateStringArray(v, row, `${path}.rows[${index}]`));
  }
  if (value.align !== undefined) {
    if (!Array.isArray(value.align)) {
      v.error(`${path}.align`, 'expected array');
    } else {
      const alignments = new Set(['left', 'right', 'center']);
      value.align.forEach((entry, index) => {
        if (entry !== null) v.enum(entry, `${path}.align[${index}]`, alignments);
      });
    }
  }
  if (v.object(value.style, `${path}.style`)) {
    for (const key of [
      'headerBackground',
      'headerColor',
      'cellBackground',
      'cellColor',
      'borderColor',
    ]) {
      v.string(value.style[key], `${path}.style.${key}`);
    }
    v.number(value.style.fontSize, `${path}.style.fontSize`);
    optionalString(v, value.style, 'fontFamily', `${path}.style`);
    optionalString(v, value.style, 'headerFontFamily', `${path}.style`);
    optionalNumber(v, value.style, 'borderRadius', `${path}.style`);
  }
}

function validateStringArray(v: TemplateValidator, value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    v.error(path, 'expected string array');
    return;
  }
  value.forEach((entry, index) => v.string(entry, `${path}[${index}]`));
}

function validateTreeContent(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  if (!Array.isArray(value.items)) {
    v.error(`${path}.items`, 'expected array');
  } else {
    value.items.forEach((item, index) => validateTreeItem(v, item, `${path}.items[${index}]`, 0));
  }
  if (v.object(value.style, `${path}.style`)) {
    for (const key of ['rowColor', 'dirColor', 'connectorColor', 'iconColor', 'commentColor']) {
      v.string(value.style[key], `${path}.style.${key}`);
    }
    v.number(value.style.fontSize, `${path}.style.fontSize`);
    v.number(value.style.indentPx, `${path}.style.indentPx`);
    optionalString(v, value.style, 'fontFamily', `${path}.style`);
    optionalString(v, value.style, 'monoFontFamily', `${path}.style`);
    optionalString(v, value.style, 'folderIcon', `${path}.style`);
    optionalString(v, value.style, 'fileIcon', `${path}.style`);
  }
}

function validateTreeItem(v: TemplateValidator, value: unknown, path: string, depth: number): void {
  if (depth > 100) {
    v.error(path, 'tree nesting exceeds 100 levels');
    return;
  }
  if (!v.object(value, path)) return;
  v.string(value.id, `${path}.id`);
  v.string(value.label, `${path}.label`);
  optionalBoolean(v, value, 'isDir', path);
  optionalString(v, value, 'comment', path);
  if (!Array.isArray(value.children)) {
    v.error(`${path}.children`, 'expected array');
  } else {
    value.children.forEach((child, index) =>
      validateTreeItem(v, child, `${path}.children[${index}]`, depth + 1),
    );
  }
}

function validateMermaidContent(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.string(value.source, `${path}.source`);
  optionalString(v, value, 'background', path);
  optionalString(v, value, 'foreground', path);
  optionalNumber(v, value, 'padding', path);
}

function validateLayer(v: TemplateValidator, value: unknown, path: string): void {
  if (!v.object(value, path)) return;
  v.string(value.id, `${path}.id`, true);
  validatePosition(v, value.position, `${path}.position`);
  if (value.animation !== undefined) validateAnimation(v, value.animation, `${path}.animation`);
  if (value.repeat !== undefined) validateRepeat(v, value.repeat, `${path}.repeat`);
  if (!v.enum(value.type, `${path}.type`, LAYER_TYPES)) return;
  const contentPath = `${path}.content`;
  switch (value.type) {
    case 'image':
      validateImageContent(v, value.content, contentPath);
      break;
    case 'text':
      if (v.object(value.content, contentPath)) {
        v.string(value.content.text, `${contentPath}.text`);
        optionalString(v, value.content, 'html', contentPath);
        validateTextStyle(v, value.content.style, `${contentPath}.style`);
      }
      break;
    case 'shape':
      validateShapeContent(v, value.content, contentPath);
      break;
    case 'path':
      validatePathContent(v, value.content, contentPath);
      break;
    case 'map':
      validateMapContent(v, value.content, contentPath);
      break;
    case 'video':
      validateVideoContent(v, value.content, contentPath);
      break;
    case 'table':
      validateTableContent(v, value.content, contentPath);
      break;
    case 'tree':
      validateTreeContent(v, value.content, contentPath);
      break;
    case 'mermaid':
      validateMermaidContent(v, value.content, contentPath);
      break;
  }
}

/**
 * Validate an untrusted custom-template definition before it reaches template
 * expansion or rendering. Unknown object keys are ignored for forward
 * compatibility, but every currently supported layer's required shape is
 * checked recursively.
 */
export function validateCustomTemplateDefinition(input: unknown): CustomTemplateValidationResult {
  const v = new TemplateValidator();
  if (!v.object(input, '$')) return { valid: false, errors: v.errors };

  v.string(input.name, '$.name', true);
  v.string(input.label, '$.label', true);
  if (input.description !== undefined) v.string(input.description, '$.description');

  if (v.object(input.viewport, '$.viewport')) {
    if (v.number(input.viewport.width, '$.viewport.width') && input.viewport.width <= 0) {
      v.error('$.viewport.width', 'expected number greater than zero');
    }
    if (v.number(input.viewport.height, '$.viewport.height') && input.viewport.height <= 0) {
      v.error('$.viewport.height', 'expected number greater than zero');
    }
  }

  if (!Array.isArray(input.layers)) {
    v.error('$.layers', 'expected array');
  } else {
    const ids = new Set<string>();
    input.layers.forEach((layer, index) => {
      validateLayer(v, layer, `$.layers[${index}]`);
      if (layer && typeof layer === 'object' && !Array.isArray(layer)) {
        const id = (layer as Record<string, unknown>).id;
        if (typeof id === 'string') {
          if (ids.has(id)) v.error(`$.layers[${index}].id`, `duplicate layer id "${id}"`);
          ids.add(id);
        }
      }
    });
  }

  if (v.errors.length > 0) return { valid: false, errors: v.errors };
  return {
    valid: true,
    errors: [],
    template: input as unknown as CustomTemplateDefinition,
  };
}

/** Type guard form of {@link validateCustomTemplateDefinition}. */
export function isCustomTemplateDefinition(input: unknown): input is CustomTemplateDefinition {
  return validateCustomTemplateDefinition(input).valid;
}

/**
 * Tag value for the YAML frontmatter key that carries inlined custom
 * template definitions. Exported so the markdown bridge stays in sync.
 */
export const FRONTMATTER_CUSTOM_TEMPLATES_KEY = 'squisq-custom-templates';
