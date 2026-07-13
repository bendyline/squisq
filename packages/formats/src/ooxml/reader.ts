/**
 * OOXML Package Reader
 *
 * Opens OOXML archives (.docx, .pptx, .xlsx) and parses their
 * structural metadata: [Content_Types].xml, relationships, and
 * core properties.
 *
 * Uses bounded JSZip member streams and a platform DOMParser (with the
 * package-owned xmldom parser in Node/SSR) to parse XML.
 */

import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';
import type { OoxmlPackage, ContentTypeMap, Relationship, CoreProperties } from './types.js';
import { NS_RELATIONSHIPS, NS_DC, NS_DCTERMS, NS_CORE_PROPERTIES } from './namespaces.js';
import {
  openBoundedZipArchive,
  type BoundedZipArchive,
  type ZipSafetyLimits,
} from '../shared/zipSafety.js';

export type OoxmlOpenOptions = ZipSafetyLimits;

type DomParserLike = new () => {
  parseFromString(source: string, mimeType: string): unknown;
};

/** Safe read sessions for opaque packages opened by this module. */
const packageArchives = new WeakMap<OoxmlPackage, BoundedZipArchive>();
const packageSignals = new WeakMap<OoxmlPackage, AbortSignal>();
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;
const MAX_RELATIONSHIPS_BYTES = 4 * 1024 * 1024;
const CANCELLATION_CHECKPOINT_INTERVAL = 256;

/** Preserve the caller's exact cancellation reason across OOXML traversal. */
export function throwIfOoxmlAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new Error('OOXML operation was cancelled');
}

async function cancellationCheckpoint(index: number, signal?: AbortSignal): Promise<void> {
  throwIfOoxmlAborted(signal);
  if (index > 0 && index % CANCELLATION_CHECKPOINT_INTERVAL === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    throwIfOoxmlAborted(signal);
  }
}

/**
 * Parse XML in browsers and Node. Test runners and SSR hosts can install a
 * partial browser DOMParser whose namespace behavior differs from browsers,
 * so Node always uses the package-owned, namespace-aware xmldom parser.
 */
function parseXml(source: string, signal?: AbortSignal): Document {
  throwIfOoxmlAborted(signal);
  const runtime = globalThis as {
    DOMParser?: DomParserLike;
    process?: { versions?: { node?: string } };
  };
  const nativeParser = runtime.process?.versions?.node ? undefined : runtime.DOMParser;
  const Parser = nativeParser ?? (XmldomDOMParser as unknown as DomParserLike);
  const doc = new Parser().parseFromString(source, 'application/xml') as Document;
  const parserErrors = doc.getElementsByTagName('parsererror');
  if (parserErrors.length > 0) {
    throw new Error(`Invalid OOXML XML part: ${parserErrors[0]?.textContent ?? 'parse error'}`);
  }
  throwIfOoxmlAborted(signal);
  return doc;
}

// ============================================
// Package Opening
// ============================================

/**
 * Open an OOXML package from raw data.
 *
 * Parses the ZIP archive, [Content_Types].xml, and root relationships.
 *
 * @param data - The raw .docx/.pptx/.xlsx file as ArrayBuffer or Blob
 * @param limits - Optional archive count, size, and compression-ratio limits
 * @returns A parsed OoxmlPackage
 */
export async function openPackage(
  data: ArrayBuffer | Blob,
  limits: OoxmlOpenOptions = {},
): Promise<OoxmlPackage> {
  throwIfOoxmlAborted(limits.signal);
  const archive = await openBoundedZipArchive(data, limits);
  const contentTypes = await parseContentTypes(archive, limits.signal);
  const rootRelationships = await parseRelationships(archive, '', limits.signal);
  throwIfOoxmlAborted(limits.signal);

  const pkg = {
    contentTypes,
    rootRelationships,
  } as unknown as OoxmlPackage;
  packageArchives.set(pkg, archive);
  if (limits.signal) packageSignals.set(pkg, limits.signal);
  return pkg;
}

// ============================================
// Content Types
// ============================================

/**
 * Parse [Content_Types].xml from the archive.
 */
async function parseContentTypes(
  archive: BoundedZipArchive,
  signal?: AbortSignal,
): Promise<ContentTypeMap> {
  const overrides = new Map<string, string>();
  const defaults = new Map<string, string>();

  const text = await archive.readText('[Content_Types].xml', MAX_CONTENT_TYPES_BYTES);
  if (text === null) return { overrides, defaults };
  const doc = parseXml(text, signal);

  // Parse <Default Extension="rels" ContentType="..." />
  const defaultEls = doc.getElementsByTagName('Default');
  for (let i = 0; i < defaultEls.length; i++) {
    await cancellationCheckpoint(i, signal);
    const el = defaultEls[i];
    const ext = el.getAttribute('Extension');
    const ct = el.getAttribute('ContentType');
    if (ext && ct) defaults.set(ext, ct);
  }

  // Parse <Override PartName="/word/document.xml" ContentType="..." />
  const overrideEls = doc.getElementsByTagName('Override');
  for (let i = 0; i < overrideEls.length; i++) {
    await cancellationCheckpoint(i, signal);
    const el = overrideEls[i];
    const partName = el.getAttribute('PartName');
    const ct = el.getAttribute('ContentType');
    if (partName && ct) {
      // Normalize: strip leading slash
      overrides.set(partName.replace(/^\//, ''), ct);
    }
  }

  return { overrides, defaults };
}

// ============================================
// Relationships
// ============================================

/**
 * Parse relationships for a specific part.
 *
 * @param pkg - The OOXML package (or the zip directly)
 * @param partPath - The part path (e.g., "word/document.xml").
 *   Use "" for root-level relationships (_rels/.rels).
 * @returns Array of relationship entries
 */
export async function getPartRelationships(
  pkg: OoxmlPackage,
  partPath: string,
): Promise<Relationship[]> {
  return parseRelationships(pkg, partPath, packageSignals.get(pkg));
}

/**
 * Parse a _rels/*.rels file from the ZIP.
 *
 * For root relationships, relsPath = "_rels/.rels".
 * For part relationships, relsPath = "<dir>/_rels/<filename>.rels".
 */
async function parseRelationships(
  source: OoxmlPackage | BoundedZipArchive,
  partPath: string,
  signal?: AbortSignal,
): Promise<Relationship[]> {
  const relsPath = partPath === '' ? '_rels/.rels' : buildRelsPath(partPath);

  const bytes = await readArchivePart(source, relsPath, MAX_RELATIONSHIPS_BYTES);
  if (!bytes) return [];
  const text = new TextDecoder().decode(bytes);
  const doc = parseXml(text, signal);
  const result: Relationship[] = [];

  const els = doc.getElementsByTagNameNS(NS_RELATIONSHIPS, 'Relationship');
  // Fallback in case namespace isn't used (some generators omit it)
  const fallbackEls = els.length > 0 ? els : doc.getElementsByTagName('Relationship');

  for (let i = 0; i < fallbackEls.length; i++) {
    await cancellationCheckpoint(i, signal);
    const el = fallbackEls[i];
    const id = el.getAttribute('Id');
    const type = el.getAttribute('Type');
    const target = el.getAttribute('Target');
    if (id && type && target) {
      const targetMode = el.getAttribute('TargetMode') as 'Internal' | 'External' | null;
      result.push({
        id,
        type,
        target,
        ...(targetMode ? { targetMode } : {}),
      });
    }
  }

  return result;
}

/**
 * Build the _rels path for a given part path.
 *
 * "word/document.xml" → "word/_rels/document.xml.rels"
 * "xl/workbook.xml"   → "xl/_rels/workbook.xml.rels"
 */
function buildRelsPath(partPath: string): string {
  const lastSlash = partPath.lastIndexOf('/');
  if (lastSlash === -1) {
    return `_rels/${partPath}.rels`;
  }
  const dir = partPath.substring(0, lastSlash);
  const file = partPath.substring(lastSlash + 1);
  return `${dir}/_rels/${file}.rels`;
}

// ============================================
// Part Access
// ============================================

/**
 * Extract an XML part from the package and parse it as a DOM Document.
 *
 * @param pkg - The OOXML package
 * @param partPath - Path within the archive (e.g., "word/document.xml")
 * @returns Parsed XML Document, or null if the part doesn't exist
 */
export async function getPartXml(pkg: OoxmlPackage, partPath: string): Promise<Document | null> {
  const signal = packageSignals.get(pkg);
  throwIfOoxmlAborted(signal);
  const bytes = await readPackagePart(pkg, partPath);
  return bytes ? parseXml(new TextDecoder().decode(bytes), signal) : null;
}

/**
 * Extract a binary part from the package (e.g., an image from word/media/).
 *
 * @param pkg - The OOXML package
 * @param partPath - Path within the archive
 * @returns The binary content, or null if the part doesn't exist
 */
export async function getPartBinary(
  pkg: OoxmlPackage,
  partPath: string,
): Promise<ArrayBuffer | null> {
  throwIfOoxmlAborted(packageSignals.get(pkg));
  const bytes = await readPackagePart(pkg, partPath);
  return bytes ? bytes.slice().buffer : null;
}

function readArchivePart(
  source: OoxmlPackage | BoundedZipArchive,
  path: string,
  maxBytes?: number,
): Promise<Uint8Array | null> {
  return 'entries' in source
    ? source.read(path, maxBytes)
    : readPackagePart(source, path, maxBytes);
}

async function readPackagePart(
  pkg: OoxmlPackage,
  path: string,
  maxBytes?: number,
): Promise<Uint8Array | null> {
  throwIfOoxmlAborted(packageSignals.get(pkg));
  const archive = packageArchives.get(pkg);
  if (!archive) {
    throw new TypeError('Invalid OoxmlPackage: create packages with openPackage().');
  }
  return archive.read(path, maxBytes);
}

// ============================================
// Core Properties
// ============================================

/**
 * Parse core document properties from docProps/core.xml.
 *
 * @param pkg - The OOXML package
 * @returns Parsed core properties (all fields optional)
 */
export async function getCoreProperties(pkg: OoxmlPackage): Promise<CoreProperties> {
  const signal = packageSignals.get(pkg);
  throwIfOoxmlAborted(signal);
  const doc = await getPartXml(pkg, 'docProps/core.xml');
  if (!doc) return {};

  function getText(ns: string, localName: string): string | undefined {
    const els = doc!.getElementsByTagNameNS(ns, localName);
    if (els.length > 0 && els[0].textContent) {
      return els[0].textContent;
    }
    return undefined;
  }

  const properties = {
    title: getText(NS_DC, 'title'),
    subject: getText(NS_DC, 'subject'),
    creator: getText(NS_DC, 'creator'),
    description: getText(NS_DC, 'description'),
    keywords: getText(NS_CORE_PROPERTIES, 'keywords'),
    lastModifiedBy: getText(NS_CORE_PROPERTIES, 'lastModifiedBy'),
    revision: getText(NS_CORE_PROPERTIES, 'revision'),
    created: getText(NS_DCTERMS, 'created'),
    modified: getText(NS_DCTERMS, 'modified'),
  };
  throwIfOoxmlAborted(signal);
  return properties;
}
