/**
 * OOXML Package Reader
 *
 * Opens OOXML archives (.docx, .pptx, .xlsx) and parses their
 * structural metadata: [Content_Types].xml, relationships, and
 * core properties.
 *
 * Uses JSZip to unzip and the browser's DOMParser to parse XML.
 */

import JSZip from 'jszip';
import type {
  OoxmlPackage,
  ContentTypeMap,
  Relationship,
  CoreProperties,
} from './types.js';
import {
  NS_RELATIONSHIPS,
  NS_DC,
  NS_DCTERMS,
  NS_CORE_PROPERTIES,
} from './namespaces.js';

// ============================================
// Package Opening
// ============================================

/**
 * Open an OOXML package from raw data.
 *
 * Parses the ZIP archive, [Content_Types].xml, and root relationships.
 *
 * @param data - The raw .docx/.pptx/.xlsx file as ArrayBuffer or Blob
 * @returns A parsed OoxmlPackage
 */
export async function openPackage(
  data: ArrayBuffer | Blob,
): Promise<OoxmlPackage> {
  const zip = await JSZip.loadAsync(data);
  const contentTypes = await parseContentTypes(zip);
  const rootRelationships = await parseRelationships(zip, '');

  return { zip, contentTypes, rootRelationships };
}

// ============================================
// Content Types
// ============================================

/**
 * Parse [Content_Types].xml from the archive.
 */
async function parseContentTypes(zip: JSZip): Promise<ContentTypeMap> {
  const overrides = new Map<string, string>();
  const defaults = new Map<string, string>();

  const file = zip.file('[Content_Types].xml');
  if (!file) return { overrides, defaults };

  const text = await file.async('text');
  const doc = new DOMParser().parseFromString(text, 'application/xml');

  // Parse <Default Extension="rels" ContentType="..." />
  const defaultEls = doc.getElementsByTagName('Default');
  for (let i = 0; i < defaultEls.length; i++) {
    const el = defaultEls[i];
    const ext = el.getAttribute('Extension');
    const ct = el.getAttribute('ContentType');
    if (ext && ct) defaults.set(ext, ct);
  }

  // Parse <Override PartName="/word/document.xml" ContentType="..." />
  const overrideEls = doc.getElementsByTagName('Override');
  for (let i = 0; i < overrideEls.length; i++) {
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
  return parseRelationships(pkg.zip, partPath);
}

/**
 * Parse a _rels/*.rels file from the ZIP.
 *
 * For root relationships, relsPath = "_rels/.rels".
 * For part relationships, relsPath = "<dir>/_rels/<filename>.rels".
 */
async function parseRelationships(
  zip: JSZip,
  partPath: string,
): Promise<Relationship[]> {
  const relsPath = partPath === ''
    ? '_rels/.rels'
    : buildRelsPath(partPath);

  const file = zip.file(relsPath);
  if (!file) return [];

  const text = await file.async('text');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const result: Relationship[] = [];

  const els = doc.getElementsByTagNameNS(NS_RELATIONSHIPS, 'Relationship');
  // Fallback in case namespace isn't used (some generators omit it)
  const fallbackEls = els.length > 0 ? els : doc.getElementsByTagName('Relationship');

  for (let i = 0; i < fallbackEls.length; i++) {
    const el = fallbackEls[i];
    const id = el.getAttribute('Id');
    const type = el.getAttribute('Type');
    const target = el.getAttribute('Target');
    if (id && type && target) {
      const targetMode = el.getAttribute('TargetMode') as
        | 'Internal'
        | 'External'
        | null;
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
export async function getPartXml(
  pkg: OoxmlPackage,
  partPath: string,
): Promise<Document | null> {
  const file = pkg.zip.file(partPath);
  if (!file) return null;

  const text = await file.async('text');
  return new DOMParser().parseFromString(text, 'application/xml');
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
  const file = pkg.zip.file(partPath);
  if (!file) return null;
  return file.async('arraybuffer');
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
export async function getCoreProperties(
  pkg: OoxmlPackage,
): Promise<CoreProperties> {
  const doc = await getPartXml(pkg, 'docProps/core.xml');
  if (!doc) return {};

  function getText(ns: string, localName: string): string | undefined {
    const els = doc!.getElementsByTagNameNS(ns, localName);
    if (els.length > 0 && els[0].textContent) {
      return els[0].textContent;
    }
    return undefined;
  }

  return {
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
}
