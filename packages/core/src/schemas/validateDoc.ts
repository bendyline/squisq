/**
 * Runtime validation for the canonical {@link Doc} JSON shape.
 *
 * TypeScript types disappear at a JSON boundary. This validator deliberately
 * lives next to the schema so every importer can apply the same structural
 * contract instead of maintaining a partial, consumer-specific guard.
 */

import type { Doc } from './Doc.js';

export interface DocSchemaIssue {
  /** JavaScript-style path to the invalid value. */
  path: string;
  /** Human-readable statement of the violated schema rule. */
  message: string;
}

type JsonRecord = Record<string, unknown>;

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

/** Return every structural problem found in a prospective Doc value. */
export function validateDocSchema(value: unknown): DocSchemaIssue[] {
  const issues: DocSchemaIssue[] = [];
  if (!isRecord(value)) {
    add(issues, '$', 'must be an object', value);
    return issues;
  }

  requiredString(value, 'articleId', 'articleId', issues);
  requiredFiniteNumber(value, 'duration', 'duration', issues, { min: 0 });

  const blocks = requiredArray(value, 'blocks', 'blocks', issues);
  if (blocks) validateBlocks(blocks, 'blocks', issues);

  const audio = requiredRecord(value, 'audio', 'audio', issues);
  if (audio) {
    const segments = requiredArray(audio, 'segments', 'audio.segments', issues);
    if (segments) validateAudioSegments(segments, issues);
  }

  optionalString(value, 'themeId', 'themeId', issues);
  optionalRecord(value, 'frontmatter', 'frontmatter', issues);
  optionalRecord(value, 'persistentLayers', 'persistentLayers', issues);
  optionalRecord(value, 'meta', 'meta', issues);
  optionalArray(value, 'customTemplates', 'customTemplates', issues);
  optionalArray(value, 'customThemes', 'customThemes', issues);

  if (value.startBlock !== undefined) validateStartBlock(value.startBlock, issues);
  if (value.captions !== undefined) validateCaptions(value.captions, issues);
  if (value.diagnostics !== undefined) validateDiagnostics(value.diagnostics, issues);
  if (value.documentMedia !== undefined) {
    validateMediaArray(value.documentMedia, 'documentMedia', issues);
  }

  return issues;
}

/** Assert that a value implements the canonical Doc JSON schema. */
export function assertDocSchema(value: unknown): asserts value is Doc {
  const issues = validateDocSchema(value);
  if (issues.length === 0) return;
  const detail = issues.map((issue) => `${issue.path} ${issue.message}`).join('; ');
  throw new TypeError(`Invalid squisq Doc: ${detail}`);
}

function validateBlocks(values: unknown[], path: string, issues: DocSchemaIssue[]): void {
  for (let index = 0; index < values.length; index += 1) {
    const blockPath = `${path}[${index}]`;
    const block = values[index];
    if (!isRecord(block)) {
      add(issues, blockPath, 'must be an object', block);
      continue;
    }

    requiredString(block, 'id', `${blockPath}.id`, issues);
    requiredFiniteNumber(block, 'startTime', `${blockPath}.startTime`, issues, { min: 0 });
    requiredFiniteNumber(block, 'duration', `${blockPath}.duration`, issues, { min: 0 });
    requiredInteger(block, 'audioSegment', `${blockPath}.audioSegment`, issues, 0);

    optionalString(block, 'sourceBlockId', `${blockPath}.sourceBlockId`, issues);
    optionalStringArray(block, 'sourceBlockIds', `${blockPath}.sourceBlockIds`, issues);
    optionalFiniteNumber(block, 'sourceCharOffset', `${blockPath}.sourceCharOffset`, issues, {
      min: 0,
    });
    optionalString(block, 'template', `${blockPath}.template`, issues);
    optionalString(block, 'title', `${blockPath}.title`, issues);
    optionalBoolean(block, 'autoTemplate', `${blockPath}.autoTemplate`, issues);
    optionalFiniteNumber(block, 'x', `${blockPath}.x`, issues);
    optionalFiniteNumber(block, 'y', `${blockPath}.y`, issues);
    optionalStringArray(block, 'classes', `${blockPath}.classes`, issues);
    optionalStringRecord(block, 'metadata', `${blockPath}.metadata`, issues);
    optionalStringRecord(block, 'templateOverrides', `${blockPath}.templateOverrides`, issues);
    optionalRecord(block, 'templateData', `${blockPath}.templateData`, issues);
    optionalArray(block, 'contents', `${blockPath}.contents`, issues);

    if (block.layers !== undefined) validateLayers(block.layers, `${blockPath}.layers`, issues);
    if (block.children !== undefined) {
      if (Array.isArray(block.children)) {
        validateBlocks(block.children, `${blockPath}.children`, issues);
      } else {
        add(issues, `${blockPath}.children`, 'must be an array', block.children);
      }
    }
    if (block.connectsTo !== undefined) {
      validateConnections(block.connectsTo, `${blockPath}.connectsTo`, issues);
    }
    if (block.media !== undefined) {
      validateMediaArray(block.media, `${blockPath}.media`, issues);
    }
  }
}

function validateLayers(value: unknown, path: string, issues: DocSchemaIssue[]): void {
  if (!Array.isArray(value)) {
    add(issues, path, 'must be an array', value);
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const layerPath = `${path}[${index}]`;
    const layer = value[index];
    if (!isRecord(layer)) {
      add(issues, layerPath, 'must be an object', layer);
      continue;
    }
    requiredString(layer, 'id', `${layerPath}.id`, issues);
    const type = requiredString(layer, 'type', `${layerPath}.type`, issues);
    if (type && !LAYER_TYPES.has(type)) {
      issues.push({
        path: `${layerPath}.type`,
        message: `must be a known layer type (got ${quote(type)})`,
      });
    }
    validatePosition(layer.position, `${layerPath}.position`, issues);
    const content = requiredRecord(layer, 'content', `${layerPath}.content`, issues);
    if (content && type) validateLayerContent(type, content, `${layerPath}.content`, issues);
    if (layer.animation !== undefined && !isRecord(layer.animation)) {
      add(issues, `${layerPath}.animation`, 'must be an object', layer.animation);
    }
  }
}

function validateLayerContent(
  type: string,
  content: JsonRecord,
  path: string,
  issues: DocSchemaIssue[],
): void {
  switch (type) {
    case 'image':
      requiredString(content, 'src', `${path}.src`, issues);
      requiredString(content, 'alt', `${path}.alt`, issues);
      break;
    case 'text':
      requiredString(content, 'text', `${path}.text`, issues);
      requiredRecord(content, 'style', `${path}.style`, issues);
      break;
    case 'shape':
      requiredString(content, 'shape', `${path}.shape`, issues);
      break;
    case 'path':
      requiredString(content, 'd', `${path}.d`, issues);
      break;
    case 'map': {
      const center = requiredRecord(content, 'center', `${path}.center`, issues);
      if (center) {
        requiredFiniteNumber(center, 'lat', `${path}.center.lat`, issues);
        requiredFiniteNumber(center, 'lng', `${path}.center.lng`, issues);
      }
      requiredFiniteNumber(content, 'zoom', `${path}.zoom`, issues);
      requiredString(content, 'style', `${path}.style`, issues);
      break;
    }
    case 'video':
      requiredString(content, 'src', `${path}.src`, issues);
      requiredString(content, 'alt', `${path}.alt`, issues);
      requiredFiniteNumber(content, 'clipStart', `${path}.clipStart`, issues, { min: 0 });
      requiredFiniteNumber(content, 'clipEnd', `${path}.clipEnd`, issues, { min: 0 });
      break;
    case 'table':
      requiredStringArray(content, 'headers', `${path}.headers`, issues);
      validateStringRows(content.rows, `${path}.rows`, issues);
      requiredRecord(content, 'style', `${path}.style`, issues);
      break;
    case 'tree':
      requiredArray(content, 'items', `${path}.items`, issues);
      requiredRecord(content, 'style', `${path}.style`, issues);
      break;
    case 'mermaid':
      requiredString(content, 'source', `${path}.source`, issues);
      break;
  }
}

function validatePosition(value: unknown, path: string, issues: DocSchemaIssue[]): void {
  if (!isRecord(value)) {
    add(issues, path, 'must be an object', value);
    return;
  }
  requiredPositionValue(value, 'x', `${path}.x`, issues);
  requiredPositionValue(value, 'y', `${path}.y`, issues);
  optionalPositionValue(value, 'width', `${path}.width`, issues);
  optionalPositionValue(value, 'height', `${path}.height`, issues);
}

function validateAudioSegments(values: unknown[], issues: DocSchemaIssue[]): void {
  for (let index = 0; index < values.length; index += 1) {
    const path = `audio.segments[${index}]`;
    const segment = values[index];
    if (!isRecord(segment)) {
      add(issues, path, 'must be an object', segment);
      continue;
    }
    requiredString(segment, 'src', `${path}.src`, issues);
    requiredString(segment, 'name', `${path}.name`, issues);
    requiredFiniteNumber(segment, 'duration', `${path}.duration`, issues, { min: 0 });
    requiredFiniteNumber(segment, 'startTime', `${path}.startTime`, issues, { min: 0 });
  }
}

function validateConnections(value: unknown, path: string, issues: DocSchemaIssue[]): void {
  if (!Array.isArray(value)) {
    add(issues, path, 'must be an array', value);
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    const connection = value[index];
    if (!isRecord(connection)) {
      add(issues, itemPath, 'must be an object', connection);
      continue;
    }
    requiredString(connection, 'target', `${itemPath}.target`, issues);
    optionalString(connection, 'type', `${itemPath}.type`, issues);
  }
}

function validateMediaArray(value: unknown, path: string, issues: DocSchemaIssue[]): void {
  if (!Array.isArray(value)) {
    add(issues, path, 'must be an array', value);
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const clipPath = `${path}[${index}]`;
    const clip = value[index];
    if (!isRecord(clip)) {
      add(issues, clipPath, 'must be an object', clip);
      continue;
    }
    requiredString(clip, 'id', `${clipPath}.id`, issues);
    requiredString(clip, 'src', `${clipPath}.src`, issues);
    requiredString(clip, 'kind', `${clipPath}.kind`, issues);
    requiredFiniteNumber(clip, 'startAt', `${clipPath}.startAt`, issues, { min: 0 });
    requiredString(clip, 'anchor', `${clipPath}.anchor`, issues);
    optionalFiniteNumber(clip, 'clipStart', `${clipPath}.clipStart`, issues, { min: 0 });
    optionalFiniteNumber(clip, 'clipEnd', `${clipPath}.clipEnd`, issues, { min: 0 });
  }
}

function validateStartBlock(value: unknown, issues: DocSchemaIssue[]): void {
  if (!isRecord(value)) {
    add(issues, 'startBlock', 'must be an object', value);
    return;
  }
  requiredString(value, 'title', 'startBlock.title', issues);
  optionalString(value, 'heroSrc', 'startBlock.heroSrc', issues);
  optionalString(value, 'heroAlt', 'startBlock.heroAlt', issues);
  optionalString(value, 'subtitle', 'startBlock.subtitle', issues);
}

function validateCaptions(value: unknown, issues: DocSchemaIssue[]): void {
  if (!isRecord(value)) {
    add(issues, 'captions', 'must be an object', value);
    return;
  }
  requiredInteger(value, 'version', 'captions.version', issues, 0);
  const phrases = requiredArray(value, 'phrases', 'captions.phrases', issues);
  if (!phrases) return;
  for (let index = 0; index < phrases.length; index += 1) {
    const path = `captions.phrases[${index}]`;
    const phrase = phrases[index];
    if (!isRecord(phrase)) {
      add(issues, path, 'must be an object', phrase);
      continue;
    }
    requiredString(phrase, 'text', `${path}.text`, issues);
    requiredFiniteNumber(phrase, 'startTime', `${path}.startTime`, issues, { min: 0 });
    requiredFiniteNumber(phrase, 'endTime', `${path}.endTime`, issues, { min: 0 });
    requiredInteger(phrase, 'audioSegment', `${path}.audioSegment`, issues, 0);
  }
}

function validateDiagnostics(value: unknown, issues: DocSchemaIssue[]): void {
  if (!Array.isArray(value)) {
    add(issues, 'diagnostics', 'must be an array', value);
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const path = `diagnostics[${index}]`;
    const diagnostic = value[index];
    if (!isRecord(diagnostic)) {
      add(issues, path, 'must be an object', diagnostic);
      continue;
    }
    requiredString(diagnostic, 'severity', `${path}.severity`, issues);
    requiredString(diagnostic, 'code', `${path}.code`, issues);
    requiredString(diagnostic, 'message', `${path}.message`, issues);
  }
}

function validateStringRows(value: unknown, path: string, issues: DocSchemaIssue[]): void {
  if (!Array.isArray(value)) {
    add(issues, path, 'must be an array', value);
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (
      !Array.isArray(value[index]) ||
      value[index].some((cell: unknown) => typeof cell !== 'string')
    ) {
      add(issues, `${path}[${index}]`, 'must be an array of strings', value[index]);
    }
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRecord(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): JsonRecord | undefined {
  const value = object[key];
  if (!isRecord(value)) {
    add(issues, path, 'must be an object', value);
    return undefined;
  }
  return value;
}

function optionalRecord(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  if (object[key] !== undefined && !isRecord(object[key])) {
    add(issues, path, 'must be an object', object[key]);
  }
}

function requiredArray(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): unknown[] | undefined {
  const value = object[key];
  if (!Array.isArray(value)) {
    add(issues, path, 'must be an array', value);
    return undefined;
  }
  return value;
}

function optionalArray(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  if (object[key] !== undefined && !Array.isArray(object[key])) {
    add(issues, path, 'must be an array', object[key]);
  }
}

function requiredString(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): string | undefined {
  const value = object[key];
  if (typeof value !== 'string') {
    add(issues, path, 'must be a string', value);
    return undefined;
  }
  return value;
}

function optionalString(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  if (object[key] !== undefined && typeof object[key] !== 'string') {
    add(issues, path, 'must be a string', object[key]);
  }
}

function requiredStringArray(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  const value = object[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    add(issues, path, 'must be an array of strings', value);
  }
}

function optionalStringArray(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  if (object[key] !== undefined) requiredStringArray(object, key, path, issues);
}

function optionalStringRecord(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  const value = object[key];
  if (value === undefined) return;
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== 'string')) {
    add(issues, path, 'must be an object whose values are strings', value);
  }
}

interface NumberRule {
  min?: number;
}

function requiredFiniteNumber(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
  rule: NumberRule = {},
): void {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    add(issues, path, 'must be a finite number', value);
  } else if (rule.min !== undefined && value < rule.min) {
    issues.push({ path, message: `must be at least ${rule.min} (got ${value})` });
  }
}

function optionalFiniteNumber(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
  rule: NumberRule = {},
): void {
  if (object[key] !== undefined) requiredFiniteNumber(object, key, path, issues, rule);
}

function requiredInteger(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
  min: number,
): void {
  const value = object[key];
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    add(issues, path, `must be an integer of at least ${min}`, value);
  }
}

function optionalBoolean(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  if (object[key] !== undefined && typeof object[key] !== 'boolean') {
    add(issues, path, 'must be a boolean', object[key]);
  }
}

function requiredPositionValue(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  const value = object[key];
  if ((typeof value !== 'number' || !Number.isFinite(value)) && typeof value !== 'string') {
    add(issues, path, 'must be a finite number or string', value);
  }
}

function optionalPositionValue(
  object: JsonRecord,
  key: string,
  path: string,
  issues: DocSchemaIssue[],
): void {
  if (object[key] !== undefined) requiredPositionValue(object, key, path, issues);
}

function add(issues: DocSchemaIssue[], path: string, message: string, value: unknown): void {
  const missing = value === undefined ? ' (field is missing)' : ` (got ${describe(value)})`;
  issues.push({ path, message: `${message}${missing}` });
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return typeof value;
}

function quote(value: string): string {
  return JSON.stringify(value);
}
