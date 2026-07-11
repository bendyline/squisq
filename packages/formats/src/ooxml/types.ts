/**
 * OOXML Types
 *
 * Shared type definitions for all Office Open XML formats (DOCX, PPTX, XLSX).
 * These model the common structural elements of the OOXML package format:
 * relationships, content types, and core properties.
 */

// ============================================
// Package
// ============================================

/**
 * An opened OOXML package. Instances are created only by `openPackage`; the
 * archive remains private so every part read goes through the bounded reader.
 */
declare const ooxmlPackageBrand: unique symbol;
export interface OoxmlPackage {
  /** Nominal brand: callers cannot manually construct a safety-bypassing package. */
  readonly [ooxmlPackageBrand]: never;
  /** Parsed [Content_Types].xml entries */
  readonly contentTypes: ContentTypeMap;
  /** Root-level relationships (_rels/.rels) */
  readonly rootRelationships: readonly Relationship[];
}

/**
 * Content type map built from [Content_Types].xml.
 * Maps part paths → content type strings plus extension defaults.
 */
export interface ContentTypeMap {
  /** Explicit overrides: partName → contentType */
  overrides: Map<string, string>;
  /** Default extensions: extension → contentType */
  defaults: Map<string, string>;
}

// ============================================
// Relationships
// ============================================

/**
 * An OOXML relationship entry (from any _rels/*.rels file).
 */
export interface Relationship {
  /** Relationship ID (e.g., "rId1") */
  id: string;
  /** Relationship type URI (e.g., "http://...officedocument/...") */
  type: string;
  /** Target path or URL */
  target: string;
  /** "Internal" (default) or "External" for hyperlinks */
  targetMode?: 'Internal' | 'External';
}

// ============================================
// Core Properties
// ============================================

/**
 * Document core properties from docProps/core.xml (Dublin Core metadata).
 */
export interface CoreProperties {
  title?: string;
  subject?: string;
  creator?: string;
  keywords?: string;
  description?: string;
  lastModifiedBy?: string;
  revision?: string;
  created?: string;
  modified?: string;
}

// ============================================
// Package Builder
// ============================================

/**
 * A part (file) that will be written into an OOXML package.
 */
export interface PackagePart {
  /** Path within the ZIP (e.g., "word/document.xml") */
  path: string;
  /** XML or text content (mutually exclusive with binaryContent) */
  content?: string;
  /** Binary content (mutually exclusive with content) */
  binaryContent?: ArrayBuffer | Uint8Array;
  /** MIME content type for [Content_Types].xml */
  contentType: string;
}

/**
 * A relationship to be written into a _rels/*.rels file.
 * `sourcePart` identifies which part the relationship belongs to.
 * Use "" (empty string) for root-level relationships (_rels/.rels).
 */
export interface PendingRelationship {
  /** The part this relationship belongs to ("" for root) */
  sourcePart: string;
  /** The relationship entry */
  relationship: Relationship;
}
