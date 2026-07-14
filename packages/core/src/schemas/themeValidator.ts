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
import { THEME_SCHEMA_VERSION } from './themeConstants.js';
import { isHex } from './colorUtils.js';
import { isTransitionType } from './Transitions.js';
import {
  PAGE_SECTION_KINDS,
  PAGE_DESIGN_FAMILIES,
  PAGE_SECTION_SPACINGS,
  PAGE_DIVIDERS,
  PAGE_BACKGROUND_RHYTHMS,
  PAGE_HERO_STYLES,
  PAGE_EYEBROWS,
  PAGE_HEADING_SCALES,
  PAGE_HEADING_CASES,
  PAGE_HEADING_UNDERLINES,
  PAGE_IMAGE_FRAMINGS,
  PAGE_SHADOWS,
  PAGE_QUOTE_MARKS,
  PAGE_NUMERAL_STYLES,
  PAGE_PATTERNS,
  PAGE_EMPHASES,
  PAGE_BACKGROUNDS,
  PAGE_ACCENT_STRATEGIES,
} from './PageStyle.js';

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
const VALID_SECTION_KINDS = new Set<string>(PAGE_SECTION_KINDS);
const VALID_DESIGN_FAMILIES = new Set<string>(PAGE_DESIGN_FAMILIES);
const VALID_PAGE_EMPHASES = new Set<string>(PAGE_EMPHASES);
const VALID_PAGE_BACKGROUNDS = new Set<string>(PAGE_BACKGROUNDS);
const VALID_ACCENT_STRATEGIES = new Set<string>(PAGE_ACCENT_STRATEGIES);
/** PageTokens enum fields → their allowed values. */
const PAGE_TOKEN_ENUMS: Record<string, Set<string>> = {
  sectionSpacing: new Set<string>(PAGE_SECTION_SPACINGS),
  divider: new Set<string>(PAGE_DIVIDERS),
  backgroundRhythm: new Set<string>(PAGE_BACKGROUND_RHYTHMS),
  heroStyle: new Set<string>(PAGE_HERO_STYLES),
  imageFraming: new Set<string>(PAGE_IMAGE_FRAMINGS),
  shadow: new Set<string>(PAGE_SHADOWS),
  quoteMark: new Set<string>(PAGE_QUOTE_MARKS),
  numeralStyle: new Set<string>(PAGE_NUMERAL_STYLES),
};
const HEADING_TREATMENT_ENUMS: Record<string, { values: Set<string>; required: boolean }> = {
  eyebrow: { values: new Set<string>(PAGE_EYEBROWS), required: true },
  scale: { values: new Set<string>(PAGE_HEADING_SCALES), required: true },
  case: { values: new Set<string>(PAGE_HEADING_CASES), required: false },
  underline: { values: new Set<string>(PAGE_HEADING_UNDERLINES), required: false },
};
const VALID_TITLE_WEIGHT = new Set(['normal', 'bold']);
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
    if (v.imageTreatment !== undefined) {
      this.imageTreatment(`${path}.imageTreatment`, v.imageTreatment);
    }
  }

  imageTreatment(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    const kinds = ['none', 'mono', 'duotone', 'warm', 'cool'];
    if (!this.isString(v.type) || !kinds.includes(v.type)) {
      this.err(`${path}.type`, `expected one of ${kinds.join('|')}`);
    }
    if (v.strength !== undefined && !this.isNumber(v.strength)) {
      this.err(`${path}.strength`, 'expected number (0..1)');
    }
    if (v.color !== undefined) this.hex(`${path}.color`, v.color);
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
        if (!this.isString(t.type) || !isTransitionType(t.type)) {
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
      if (v.template === 'patternBackground') {
        const patterns = ['dots', 'grid', 'diagonal', 'noise'];
        if (!this.isString(cfg.pattern) || !patterns.includes(cfg.pattern)) {
          this.err(`${path}.config.pattern`, `expected one of ${patterns.join('|')}`);
        }
        for (const k of ['opacity', 'scale']) {
          if (cfg[k] !== undefined && !this.isNumber(cfg[k])) {
            this.err(`${path}.config.${k}`, 'expected number');
          }
        }
        if (cfg.color !== undefined) this.hex(`${path}.config.color`, cfg.color);
      }
      if (v.template === 'vignette') {
        if (cfg.strength !== undefined && !this.isNumber(cfg.strength)) {
          this.err(`${path}.config.strength`, 'expected number (0..1)');
        }
        if (cfg.color !== undefined) this.hex(`${path}.config.color`, cfg.color);
      }
      if (v.template === 'ambientGradient') {
        if (cfg.duration !== undefined && !this.isNumber(cfg.duration)) {
          this.err(`${path}.config.duration`, 'expected number (seconds)');
        }
        for (const k of ['from', 'to']) {
          if (cfg[k] !== undefined) this.hex(`${path}.config.${k}`, cfg[k]);
        }
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

  scalarHints(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    for (const key of Object.keys(v)) {
      const t = typeof v[key];
      if (t !== 'string' && t !== 'number' && t !== 'boolean') {
        this.err(`${path}.${key}`, `expected string|number|boolean, got ${t}`);
      }
    }
  }

  pageSectionOverride(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    if (v.kind !== undefined && (!this.isString(v.kind) || !VALID_SECTION_KINDS.has(v.kind))) {
      this.err(`${path}.kind`, `expected one of: ${PAGE_SECTION_KINDS.join(', ')}`);
    }
    if (v.variant !== undefined && !this.isString(v.variant)) {
      this.err(`${path}.variant`, 'expected string');
    }
    if (
      v.emphasis !== undefined &&
      (!this.isString(v.emphasis) || !VALID_PAGE_EMPHASES.has(v.emphasis))
    ) {
      this.err(`${path}.emphasis`, `expected one of: ${PAGE_EMPHASES.join(', ')}`);
    }
    if (
      v.background !== undefined &&
      (!this.isString(v.background) || !VALID_PAGE_BACKGROUNDS.has(v.background))
    ) {
      this.err(`${path}.background`, `expected one of: ${PAGE_BACKGROUNDS.join(', ')}`);
    }
    if (v.hints !== undefined) this.scalarHints(`${path}.hints`, v.hints);
  }

  pageTokens(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    for (const k of ['contentMaxWidth', 'wideMaxWidth', 'cornerRadius']) {
      if (!this.isNumber(v[k])) {
        this.err(`${path}.${k}`, 'expected number');
      }
    }
    for (const [k, values] of Object.entries(PAGE_TOKEN_ENUMS)) {
      if (!this.isString(v[k]) || !values.has(v[k] as string)) {
        this.err(`${path}.${k}`, `expected one of: ${Array.from(values).join(', ')}`);
      }
    }
    if (v.pattern !== undefined) {
      if (!this.isString(v.pattern) || !(PAGE_PATTERNS as readonly string[]).includes(v.pattern)) {
        this.err(`${path}.pattern`, `expected one of: ${PAGE_PATTERNS.join(', ')}`);
      }
    }
    const ht = v.headingTreatment;
    if (!this.isObject(ht)) {
      this.err(`${path}.headingTreatment`, 'expected object');
      return;
    }
    for (const [k, spec] of Object.entries(HEADING_TREATMENT_ENUMS)) {
      const val = ht[k];
      if (val === undefined) {
        if (spec.required) this.err(`${path}.headingTreatment.${k}`, 'required');
        continue;
      }
      if (!this.isString(val) || !spec.values.has(val)) {
        this.err(
          `${path}.headingTreatment.${k}`,
          `expected one of: ${Array.from(spec.values).join(', ')}`,
        );
      }
    }
  }

  pageStyle(path: string, v: unknown): void {
    if (!this.isObject(v)) {
      this.err(path, 'expected object');
      return;
    }
    if (!this.isString(v.family) || !VALID_DESIGN_FAMILIES.has(v.family)) {
      this.err(`${path}.family`, `expected one of: ${PAGE_DESIGN_FAMILIES.join(', ')}`);
    }
    if (v.tokens === undefined) {
      this.err(`${path}.tokens`, 'required');
    } else {
      this.pageTokens(`${path}.tokens`, v.tokens);
    }
    if (v.sections !== undefined) {
      if (!this.isObject(v.sections)) {
        this.err(`${path}.sections`, 'expected object map');
      } else {
        for (const key of Object.keys(v.sections)) {
          if (!VALID_SECTION_KINDS.has(key)) {
            this.err(`${path}.sections.${key}`, `unknown section kind`);
            continue;
          }
          this.pageSectionOverride(`${path}.sections.${key}`, v.sections[key]);
        }
      }
    }
    if (v.templates !== undefined) {
      if (!this.isObject(v.templates)) {
        this.err(`${path}.templates`, 'expected object map');
      } else {
        for (const key of Object.keys(v.templates)) {
          this.pageSectionOverride(`${path}.templates.${key}`, v.templates[key]);
        }
      }
    }
    if (v.accentRotation === undefined) {
      this.err(`${path}.accentRotation`, 'required');
    } else if (!this.isObject(v.accentRotation)) {
      this.err(`${path}.accentRotation`, 'expected object');
    } else {
      const rotation = v.accentRotation;
      if (!this.isString(rotation.strategy) || !VALID_ACCENT_STRATEGIES.has(rotation.strategy)) {
        this.err(
          `${path}.accentRotation.strategy`,
          `expected one of: ${PAGE_ACCENT_STRATEGIES.join(', ')}`,
        );
      }
      if (rotation.schemes !== undefined) {
        if (
          !Array.isArray(rotation.schemes) ||
          rotation.schemes.some((s) => typeof s !== 'string')
        ) {
          this.err(`${path}.accentRotation.schemes`, 'expected array of strings');
        }
      }
    }
  }
}

export function validateTheme(input: unknown): ValidationResult {
  const v = new V();
  if (!v.isObject(input)) {
    return { valid: false, errors: [{ path: '', message: 'expected object' }] };
  }

  if (input.schemaVersion !== THEME_SCHEMA_VERSION) {
    v.err(
      'schemaVersion',
      `expected "${THEME_SCHEMA_VERSION}", got "${String(input.schemaVersion)}"`,
    );
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
  if (input.basedOn !== undefined && !v.isString(input.basedOn)) {
    v.err('basedOn', 'expected string');
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

  if (input.pageStyle !== undefined) {
    v.pageStyle('pageStyle', input.pageStyle);
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
