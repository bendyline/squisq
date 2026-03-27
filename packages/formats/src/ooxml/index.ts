/**
 * @bendyline/squisq-formats OOXML Module
 *
 * Shared infrastructure for reading and writing Office Open XML packages
 * (DOCX, PPTX, XLSX). Provides ZIP archive handling, relationship management,
 * content type assembly, XML utilities, and core property parsing.
 *
 * This module is consumed by the format-specific modules (docx/, pptx/, xlsx/)
 * and can also be imported directly by advanced consumers.
 *
 * @example
 * ```ts
 * import { createPackage, openPackage } from '@bendyline/squisq-formats/ooxml';
 * ```
 */

// Types
export type {
  OoxmlPackage,
  ContentTypeMap,
  Relationship,
  CoreProperties,
  PackagePart,
  PendingRelationship,
} from './types.js';

// Reader
export {
  openPackage,
  getPartRelationships,
  getPartXml,
  getPartBinary,
  getCoreProperties,
} from './reader.js';

// Writer
export type { OoxmlPackageBuilder } from './writer.js';
export { createPackage } from './writer.js';

// XML Utilities
export {
  xmlDeclaration,
  escapeXml,
  attrString,
  selfClosingElement,
  xmlElement,
  textElement,
} from './xmlUtils.js';

// Namespace constants
export {
  NS_RELATIONSHIPS,
  NS_CONTENT_TYPES,
  REL_OFFICE_DOCUMENT,
  REL_CORE_PROPERTIES,
  REL_EXTENDED_PROPERTIES,
  REL_STYLES,
  REL_NUMBERING,
  REL_FONT_TABLE,
  REL_SETTINGS,
  REL_HYPERLINK,
  REL_IMAGE,
  REL_FOOTNOTES,
  REL_THEME,
  NS_WML,
  NS_PML,
  NS_SML,
  NS_DRAWINGML,
  NS_WP_DRAWING,
  NS_PICTURE,
  NS_DC,
  NS_DCTERMS,
  NS_CORE_PROPERTIES,
  NS_XSI,
  NS_MC,
  NS_R,
  CONTENT_TYPE_RELATIONSHIPS,
  CONTENT_TYPE_CORE_PROPERTIES,
  CONTENT_TYPE_DOCX_DOCUMENT,
  CONTENT_TYPE_DOCX_STYLES,
  CONTENT_TYPE_DOCX_NUMBERING,
  CONTENT_TYPE_DOCX_SETTINGS,
  CONTENT_TYPE_DOCX_FONT_TABLE,
  CONTENT_TYPE_DOCX_FOOTNOTES,
  CONTENT_TYPE_PPTX_PRESENTATION,
  CONTENT_TYPE_PPTX_SLIDE,
  CONTENT_TYPE_PPTX_SLIDE_LAYOUT,
  CONTENT_TYPE_PPTX_SLIDE_MASTER,
  CONTENT_TYPE_PPTX_THEME,
  REL_SLIDE,
  REL_SLIDE_LAYOUT,
  REL_SLIDE_MASTER,
  CONTENT_TYPE_XLSX_WORKBOOK,
} from './namespaces.js';
