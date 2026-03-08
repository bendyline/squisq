/**
 * OOXML Package Writer
 *
 * Builds OOXML archives (.docx, .pptx, .xlsx) from parts.
 * Handles automatic generation of [Content_Types].xml and
 * _rels/*.rels files from the registered parts and relationships.
 */

import JSZip from 'jszip';
import type {
  CoreProperties,
  PackagePart,
  PendingRelationship,
  Relationship,
} from './types.js';
import {
  NS_CONTENT_TYPES,
  NS_RELATIONSHIPS,
  NS_CORE_PROPERTIES,
  NS_DC,
  NS_DCTERMS,
  NS_XSI,
  CONTENT_TYPE_RELATIONSHIPS,
  CONTENT_TYPE_CORE_PROPERTIES,
  REL_CORE_PROPERTIES,
} from './namespaces.js';
import {
  xmlDeclaration,
  escapeXml,
  xmlElement,
  textElement,
  attrString,
} from './xmlUtils.js';

// ============================================
// Package Builder
// ============================================

/**
 * Mutable builder for constructing an OOXML package.
 *
 * Add parts, relationships, and core properties, then call `toBlob()`
 * or `toArrayBuffer()` to produce the final ZIP archive.
 *
 * @example
 * ```ts
 * const builder = createPackage();
 * builder.addPart('word/document.xml', documentXml, CONTENT_TYPE_DOCX_DOCUMENT);
 * builder.addRelationship('', {
 *   id: 'rId1',
 *   type: REL_OFFICE_DOCUMENT,
 *   target: 'word/document.xml',
 * });
 * const blob = await builder.toBlob();
 * ```
 */
export interface OoxmlPackageBuilder {
  /**
   * Add an XML or text part to the package.
   *
   * @param path - Path within the archive (e.g., "word/document.xml")
   * @param content - XML string content
   * @param contentType - MIME content type for [Content_Types].xml
   */
  addPart(path: string, content: string, contentType: string): void;

  /**
   * Add a binary part to the package (e.g., an image).
   *
   * @param path - Path within the archive (e.g., "word/media/image1.png")
   * @param data - Binary content
   * @param contentType - MIME content type (e.g., "image/png")
   */
  addBinaryPart(
    path: string,
    data: ArrayBuffer | Uint8Array,
    contentType: string,
  ): void;

  /**
   * Register a relationship.
   *
   * @param sourcePart - The part this relationship belongs to (e.g., "word/document.xml").
   *   Use "" (empty string) for root-level relationships (_rels/.rels).
   * @param rel - The relationship entry
   */
  addRelationship(sourcePart: string, rel: Relationship): void;

  /**
   * Set core document properties (docProps/core.xml).
   * Calling this multiple times overwrites previous values.
   */
  setCoreProperties(props: CoreProperties): void;

  /**
   * Assemble the final OOXML package as a Blob.
   * Generates [Content_Types].xml and all _rels/*.rels files automatically.
   */
  toBlob(): Promise<Blob>;

  /**
   * Assemble the final OOXML package as an ArrayBuffer.
   */
  toArrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Create a new OOXML package builder.
 */
export function createPackage(): OoxmlPackageBuilder {
  const parts: PackagePart[] = [];
  const relationships: PendingRelationship[] = [];
  let coreProps: CoreProperties | undefined;

  return {
    addPart(path, content, contentType) {
      parts.push({ path, content, contentType });
    },

    addBinaryPart(path, data, contentType) {
      parts.push({ path, binaryContent: data, contentType });
    },

    addRelationship(sourcePart, rel) {
      relationships.push({ sourcePart, relationship: rel });
    },

    setCoreProperties(props) {
      coreProps = props;
    },

    async toBlob() {
      const zip = assemble(parts, relationships, coreProps);
      return zip.generateAsync({ type: 'blob' });
    },

    async toArrayBuffer() {
      const zip = assemble(parts, relationships, coreProps);
      return zip.generateAsync({ type: 'arraybuffer' });
    },
  };
}

// ============================================
// Assembly
// ============================================

/**
 * Assemble a JSZip archive from parts, relationships, and core properties.
 */
function assemble(
  parts: PackagePart[],
  relationships: PendingRelationship[],
  coreProps?: CoreProperties,
): JSZip {
  const zip = new JSZip();

  // Write content parts
  for (const part of parts) {
    if (part.content !== undefined) {
      zip.file(part.path, part.content);
    } else if (part.binaryContent !== undefined) {
      zip.file(part.path, part.binaryContent);
    }
  }

  // Add core properties if set
  if (coreProps) {
    const coreXml = buildCorePropertiesXml(coreProps);
    zip.file('docProps/core.xml', coreXml);

    // Add relationship to core properties
    relationships.push({
      sourcePart: '',
      relationship: {
        id: `rId${relationships.length + 100}`,
        type: REL_CORE_PROPERTIES,
        target: 'docProps/core.xml',
      },
    });
  }

  // Build and write [Content_Types].xml
  zip.file('[Content_Types].xml', buildContentTypesXml(parts, coreProps));

  // Build and write _rels/*.rels files
  const relsBySource = groupRelationshipsBySource(relationships);
  for (const [sourcePart, rels] of relsBySource) {
    const relsPath =
      sourcePart === '' ? '_rels/.rels' : buildRelsPath(sourcePart);
    zip.file(relsPath, buildRelationshipsXml(rels));
  }

  return zip;
}

// ============================================
// [Content_Types].xml
// ============================================

function buildContentTypesXml(
  parts: PackagePart[],
  coreProps?: CoreProperties,
): string {
  const lines: string[] = [xmlDeclaration()];
  lines.push(
    `<Types xmlns="${NS_CONTENT_TYPES}">`,
  );

  // Default extension types
  const extensionTypes = new Map<string, string>();
  extensionTypes.set('rels', CONTENT_TYPE_RELATIONSHIPS);
  extensionTypes.set('xml', 'application/xml');

  // Collect extensions from binary parts (e.g., png, jpeg)
  for (const part of parts) {
    if (part.binaryContent !== undefined) {
      const ext = getExtension(part.path);
      if (ext && !extensionTypes.has(ext)) {
        extensionTypes.set(ext, part.contentType);
      }
    }
  }

  for (const [ext, ct] of extensionTypes) {
    lines.push(
      `  <Default Extension="${escapeXml(ext)}" ContentType="${escapeXml(ct)}"/>`,
    );
  }

  // Override entries for each XML part
  for (const part of parts) {
    if (part.content !== undefined) {
      lines.push(
        `  <Override PartName="/${escapeXml(part.path)}" ContentType="${escapeXml(part.contentType)}"/>`,
      );
    }
  }

  // Core properties override
  if (coreProps) {
    lines.push(
      `  <Override PartName="/docProps/core.xml" ContentType="${CONTENT_TYPE_CORE_PROPERTIES}"/>`,
    );
  }

  lines.push('</Types>');
  return lines.join('\n');
}

// ============================================
// Relationships XML
// ============================================

function buildRelationshipsXml(rels: Relationship[]): string {
  const lines: string[] = [xmlDeclaration()];
  lines.push(`<Relationships xmlns="${NS_RELATIONSHIPS}">`);

  for (const rel of rels) {
    const attrs: string[] = [
      `Id="${escapeXml(rel.id)}"`,
      `Type="${escapeXml(rel.type)}"`,
      `Target="${escapeXml(rel.target)}"`,
    ];
    if (rel.targetMode) {
      attrs.push(`TargetMode="${escapeXml(rel.targetMode)}"`);
    }
    lines.push(`  <Relationship ${attrs.join(' ')}/>`);
  }

  lines.push('</Relationships>');
  return lines.join('\n');
}

// ============================================
// Core Properties XML
// ============================================

function buildCorePropertiesXml(props: CoreProperties): string {
  const lines: string[] = [xmlDeclaration()];
  lines.push(
    `<cp:coreProperties` +
    ` xmlns:cp="${NS_CORE_PROPERTIES}"` +
    ` xmlns:dc="${NS_DC}"` +
    ` xmlns:dcterms="${NS_DCTERMS}"` +
    ` xmlns:xsi="${NS_XSI}">`,
  );

  if (props.title) lines.push(`  <dc:title>${escapeXml(props.title)}</dc:title>`);
  if (props.subject) lines.push(`  <dc:subject>${escapeXml(props.subject)}</dc:subject>`);
  if (props.creator) lines.push(`  <dc:creator>${escapeXml(props.creator)}</dc:creator>`);
  if (props.description) lines.push(`  <dc:description>${escapeXml(props.description)}</dc:description>`);
  if (props.keywords) lines.push(`  <cp:keywords>${escapeXml(props.keywords)}</cp:keywords>`);
  if (props.lastModifiedBy) lines.push(`  <cp:lastModifiedBy>${escapeXml(props.lastModifiedBy)}</cp:lastModifiedBy>`);
  if (props.revision) lines.push(`  <cp:revision>${escapeXml(props.revision)}</cp:revision>`);
  if (props.created) {
    lines.push(`  <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(props.created)}</dcterms:created>`);
  }
  if (props.modified) {
    lines.push(`  <dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(props.modified)}</dcterms:modified>`);
  }

  lines.push('</cp:coreProperties>');
  return lines.join('\n');
}

// ============================================
// Helpers
// ============================================

function getExtension(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  return path.substring(dot + 1).toLowerCase();
}

function buildRelsPath(partPath: string): string {
  const lastSlash = partPath.lastIndexOf('/');
  if (lastSlash === -1) {
    return `_rels/${partPath}.rels`;
  }
  const dir = partPath.substring(0, lastSlash);
  const file = partPath.substring(lastSlash + 1);
  return `${dir}/_rels/${file}.rels`;
}

function groupRelationshipsBySource(
  pending: PendingRelationship[],
): Map<string, Relationship[]> {
  const grouped = new Map<string, Relationship[]>();
  for (const { sourcePart, relationship } of pending) {
    let list = grouped.get(sourcePart);
    if (!list) {
      list = [];
      grouped.set(sourcePart, list);
    }
    list.push(relationship);
  }
  return grouped;
}
