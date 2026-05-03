/**
 * Theme Validator
 *
 * Hand-rolled validator for `Theme` JSON. No dependencies. Produces a
 * flat list of typed errors with JSON paths, suitable for surfacing in
 * the customizer UI or throwing at module init for built-in themes.
 *
 * Design: walk the candidate object, push errors for each violation.
 * Coverage is exhaustive for required fields and shapes; permissive on
 * forward-compatible fields (unknown keys are ignored, not rejected).
 */

import type { Theme, ThemeColorPalette } from './Theme.js';
import { THEME_SCHEMA_VERSION } from './Theme.js';
import { isHex } from './colorUtils.js';

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** Present only when `valid === true`. The same input typed as `Theme`. */
  theme?: Theme;
}

const VALID_FALLBACK = new Set(['serif', 'sans-serif', 'monospace', 'system-ui']);
const VALID_TITLE_WEIGHT = new Set(['normal', 'bold']);
const VALID_TRANSITION_TYPES = new Set([
  'cut',
  'fade',
  'dissolve',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'zoom',
]);
const VALID_GRADIENT_PRESETS = new Set([
  'dark-vignette',
  'radial-dark',
  'warm-sunset',
  'cool-blue',
  'earth-tones',
]);

class V {
  errors: ValidationError[] = [];
  err(path: string, message: string): void {
    this.errors.push({ path, message });
  }
  isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }
  isString(v: unknown): v is string {
    return typeof v === 'string';
  }
  isNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
  }
  isBoolean(v: unknown): v is boolean {
    return typeof v === 'boolean';
  }
  hex(path: string, v: unknown): void {
    if (!this.isString(v)) {
      this.err(path, `expected hex color string, got ${typeof v}`);
    } else if (!isHex(v)) {
      this.err(path, `expected #rgb or #rrggbb hex color, got "${v}"`);
    }
  }

  palette(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    const required: (keyof ThemeColorPalette)[] = [
      'primary',
      'secondary',
      'background',
      'backgroundLight',
      'text',
      'textMuted',
      'highlight',
      'warning',
    ];
    for (const k of required) this.hex(`${path}.${k}`, v[k]);
  }

  colorScheme(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    this.hex(`${path}.bg`, v.bg);
    this.hex(`${path}.text`, v.text);
    this.hex(`${path}.accent`, v.accent);
  }

  colorSchemes(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object map');
      return;
    }
    for (const key of Object.keys(v)) {
      this.colorScheme(`${path}.${key}`, v[key]);
    }
  }

  fontFamily(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected FontFamily object ({ stackId } or { custom })');
      return;
    }
    if ('stackId' in v) {
      if (!this.isString(v.stackId) || v.stackId.length === 0) {
        this.err(`${path}.stackId`, 'expected non-empty string');
      }
      return;
    }
    if ('custom' in v) {
      const c = v.custom;
      if (!this.isObject(c)) {
        this.err(`${path}.custom`, 'expected { name, fallback } object');
        return;
      }
      if (!this.isString(c.name) || c.name.length === 0) {
        this.err(`${path}.custom.name`, 'expected non-empty string');
      }
      if (!this.isString(c.fallback) || !VALID_FALLBACK.has(c.fallback)) {
        this.err(
          `${path}.custom.fallback`,
          `expected one of: serif, sans-serif, monospace, system-ui`,
        );
      }
      return;
    }
    this.err(path, 'expected { stackId } or { custom: { name, fallback } }');
  }

  typography(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    this.fontFamily(`${path}.bodyFont`, v.bodyFont);
    this.fontFamily(`${path}.titleFont`, v.titleFont);
    if (v.monoFont !== undefined) this.fontFamily(`${path}.monoFont`, v.monoFont);
    for (const k of ['titleScale', 'bodyScale', 'lineHeight', 'titleLineHeight']) {
      if (v[k] !== undefined && !this.isNumber(v[k])) {
        this.err(`${path}.${k}`, `expected number, got ${typeof v[k]}`);
      }
    }
    if (v.titleWeight !== undefined) {
      if (!this.isString(v.titleWeight) || !VALID_TITLE_WEIGHT.has(v.titleWeight)) {
        this.err(`${path}.titleWeight`, 'expected "normal" or "bold"');
      }
    }
  }

  style(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    if (v.borderRadius !== undefined && !this.isNumber(v.borderRadius)) {
      this.err(`${path}.borderRadius`, 'expected number');
    }
    if (v.textShadow !== undefined && !this.isBoolean(v.textShadow)) {
      this.err(`${path}.textShadow`, 'expected boolean');
    }
    for (const k of ['overlayOpacity', 'animationSpeed']) {
      if (v[k] !== undefined && !this.isNumber(v[k])) {
        this.err(`${path}.${k}`, 'expected number');
      }
    }
    if (v.blockPadding !== undefined && !this.isString(v.blockPadding)) {
      this.err(`${path}.blockPadding`, 'expected string (percentage e.g. "5%")');
    }
  }

  renderStyle(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    if (!this.isString(v.name) || v.name.length === 0) {
      this.err(`${path}.name`, 'expected non-empty string');
    }
    if (v.ambientMotion !== undefined && !this.isBoolean(v.ambientMotion)) {
      this.err(`${path}.ambientMotion`, 'expected boolean');
    }
    for (const k of ['defaultTextAnimation', 'defaultImageAnimation']) {
      if (v[k] !== undefined && !this.isString(v[k])) {
        this.err(`${path}.${k}`, 'expected animation type string');
      }
    }
    if (v.defaultTransition !== undefined) {
      const t = v.defaultTransition;
      if (!this.isObject(t)) {
        this.err(`${path}.defaultTransition`, 'expected object');
      } else {
        if (!this.isString(t.type) || !VALID_TRANSITION_TYPES.has(t.type)) {
          this.err(`${path}.defaultTransition.type`, 'expected valid transition type');
        }
        if (t.duration !== undefined && !this.isNumber(t.duration)) {
          this.err(`${path}.defaultTransition.duration`, 'expected number');
        }
      }
    }
    if (v.layoutOverrides !== undefined && !this.isObject(v.layoutOverrides)) {
      this.err(`${path}.layoutOverrides`, 'expected object');
    }
    if (v.templateHints !== undefined) {
      if (!this.isObject(v.templateHints)) {
        this.err(`${path}.templateHints`, 'expected object map');
      } else {
        for (const tplName of Object.keys(v.templateHints)) {
          const hints = v.templateHints[tplName];
          if (!this.isObject(hints)) {
            this.err(`${path}.templateHints.${tplName}`, 'expected object');
            continue;
          }
          for (const key of Object.keys(hints)) {
            const val = hints[key];
            const t = typeof val;
            if (t !== 'string' && t !== 'number' && t !== 'boolean') {
              this.err(
                `${path}.templateHints.${tplName}.${key}`,
                `expected string|number|boolean, got ${t}`,
              );
            }
          }
        }
      }
    }
  }

  seedColors(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    if (v.primary === undefined) {
      this.err(`${path}.primary`, 'required when seedColors is present');
    } else {
      this.hex(`${path}.primary`, v.primary);
    }
    for (const k of ['secondary', 'accent', 'background', 'text']) {
      if (v[k] !== undefined) this.hex(`${path}.${k}`, v[k]);
    }
  }

  persistentLayer(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    // Either { template, config } or a raw Layer — only validate the template form here
    if ('template' in v) {
      if (!this.isString(v.template)) {
        this.err(`${path}.template`, 'expected string');
        return;
      }
      const cfg = v.config;
      if (!this.isObject(cfg)) {
        this.err(`${path}.config`, 'expected object');
        return;
      }
      if (cfg.type !== v.template) {
        this.err(`${path}.config.type`, `expected "${v.template}", got "${String(cfg.type)}"`);
      }
      if (v.template === 'gradientBackground' && cfg.preset !== undefined) {
        if (!this.isString(cfg.preset) || !VALID_GRADIENT_PRESETS.has(cfg.preset)) {
          this.err(
            `${path}.config.preset`,
            `expected one of: ${Array.from(VALID_GRADIENT_PRESETS).join(', ')}`,
          );
        }
      }
      if (v.template === 'gradientBackground' && 'gradient' in cfg) {
        this.err(
          `${path}.config.gradient`,
          'raw CSS gradient strings are not allowed in Theme JSON; use a `preset`',
        );
      }
    }
    // Raw Layer form is permissive — no schema check here
  }

  persistentLayers(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    for (const side of ['bottomLayers', 'topLayers']) {
      const arr = v[side];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) {
        this.err(`${path}.${side}`, 'expected array');
        continue;
      }
      arr.forEach((entry, i) => this.persistentLayer(`${path}.${side}[${i}]`, entry));
    }
  }
}

export function validateTheme(input: unknown): ValidationResult {
  const v = new V();
  if (!v.isObject(input)) {
    return { valid: false, errors: [{ path: '', message: 'expected object' }] };
  }

  if (input.schemaVersion !== THEME_SCHEMA_VERSION) {
    v.err('schemaVersion', `expected "${THEME_SCHEMA_VERSION}", got "${String(input.schemaVersion)}"`);
  }
  if (!v.isString(input.id) || input.id.length === 0) {
    v.err('id', 'expected non-empty string');
  }
  if (!v.isString(input.name) || input.name.length === 0) {
    v.err('name', 'expected non-empty string');
  }
  if (input.description !== undefined && !v.isString(input.description)) {
    v.err('description', 'expected string');
  }

  if (input.seedColors !== undefined) v.seedColors('seedColors', input.seedColors);

  if (input.colors === undefined) {
    v.err('colors', 'required');
  } else {
    v.palette('colors', input.colors);
  }

  if (input.typography === undefined) {
    v.err('typography', 'required');
  } else {
    v.typography('typography', input.typography);
  }

  if (input.style === undefined) {
    v.err('style', 'required');
  } else {
    v.style('style', input.style);
  }

  if (input.renderStyle === undefined) {
    v.err('renderStyle', 'required');
  } else {
    v.renderStyle('renderStyle', input.renderStyle);
  }

  if (input.colorSchemes === undefined) {
    v.err('colorSchemes', 'required');
  } else {
    v.colorSchemes('colorSchemes', input.colorSchemes);
  }

  if (input.persistentLayers !== undefined) {
    v.persistentLayers('persistentLayers', input.persistentLayers);
  }

  if (v.errors.length === 0) {
    return { valid: true, errors: [], theme: input as unknown as Theme };
  }
  return { valid: false, errors: v.errors };
}

/** Throws on invalid input. Useful at module init for built-in themes. */
export function assertTheme(input: unknown, source = 'theme'): Theme {
  const result = validateTheme(input);
  if (!result.valid || !result.theme) {
    const summary = result.errors
      .slice(0, 5)
      .map((e) => `  ${e.path || '<root>'}: ${e.message}`)
      .join('\n');
    const more = result.errors.length > 5 ? `\n  ... and ${result.errors.length - 5} more` : '';
    throw new Error(`Invalid ${source}:\n${summary}${more}`);
  }
  return result.theme;
}

// (Theme types are re-exported from `./Theme.js` via the schemas barrel.)
