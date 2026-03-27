/**
 * OOXML Namespace Constants
 *
 * All Office Open XML namespace URIs used across DOCX, PPTX, and XLSX.
 * Organized by category for easy reference.
 */

// ============================================
// Package-level namespaces (shared by all formats)
// ============================================

/** Relationships namespace (used in _rels/*.rels files) */
export const NS_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Content Types namespace ([Content_Types].xml) */
export const NS_CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';

// ============================================
// Relationship type URIs
// ============================================

/** Relationship type: Office document (main part) */
export const REL_OFFICE_DOCUMENT =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Relationship type: Core properties */
export const REL_CORE_PROPERTIES =
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';

/** Relationship type: Extended properties (app.xml) */
export const REL_EXTENDED_PROPERTIES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';

/** Relationship type: Styles */
export const REL_STYLES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/** Relationship type: Numbering */
export const REL_NUMBERING =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

/** Relationship type: Font table */
export const REL_FONT_TABLE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';

/** Relationship type: Settings */
export const REL_SETTINGS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';

/** Relationship type: Hyperlink */
export const REL_HYPERLINK =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

/** Relationship type: Image */
export const REL_IMAGE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/** Relationship type: Footnotes */
export const REL_FOOTNOTES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';

/** Relationship type: Theme */
export const REL_THEME =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';

// ============================================
// WordprocessingML (DOCX)
// ============================================

/** WordprocessingML main namespace (w:) */
export const NS_WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ============================================
// PresentationML (PPTX)
// ============================================

/** PresentationML main namespace (p:) */
export const NS_PML = 'http://schemas.openxmlformats.org/presentationml/2006/main';

// ============================================
// SpreadsheetML (XLSX)
// ============================================

/** SpreadsheetML main namespace */
export const NS_SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

// ============================================
// DrawingML (shared across formats)
// ============================================

/** DrawingML main namespace (a:) */
export const NS_DRAWINGML = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/** DrawingML WordprocessingML drawing namespace (wp:) */
export const NS_WP_DRAWING =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

/** DrawingML picture namespace (pic:) */
export const NS_PICTURE = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

// ============================================
// Dublin Core / Core Properties
// ============================================

/** Dublin Core elements namespace */
export const NS_DC = 'http://purl.org/dc/elements/1.1/';

/** Dublin Core terms namespace */
export const NS_DCTERMS = 'http://purl.org/dc/terms/';

/** Core properties namespace */
export const NS_CORE_PROPERTIES =
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';

/** XML Schema Instance namespace */
export const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';

// ============================================
// Markup Compatibility
// ============================================

/** Markup Compatibility namespace (mc:) */
export const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** Office relationships namespace (r:) */
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// ============================================
// Content type strings
// ============================================

export const CONTENT_TYPE_RELATIONSHIPS =
  'application/vnd.openxmlformats-package.relationships+xml';

export const CONTENT_TYPE_CORE_PROPERTIES =
  'application/vnd.openxmlformats-package.core-properties+xml';

export const CONTENT_TYPE_DOCX_DOCUMENT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

export const CONTENT_TYPE_DOCX_STYLES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

export const CONTENT_TYPE_DOCX_NUMBERING =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';

export const CONTENT_TYPE_DOCX_SETTINGS =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';

export const CONTENT_TYPE_DOCX_FONT_TABLE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml';

export const CONTENT_TYPE_DOCX_FOOTNOTES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';

export const CONTENT_TYPE_PPTX_PRESENTATION =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';

export const CONTENT_TYPE_PPTX_SLIDE =
  'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';

export const CONTENT_TYPE_PPTX_SLIDE_LAYOUT =
  'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml';

export const CONTENT_TYPE_PPTX_SLIDE_MASTER =
  'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';

export const CONTENT_TYPE_PPTX_THEME = 'application/vnd.openxmlformats-officedocument.theme+xml';

/** Relationship type: Slide */
export const REL_SLIDE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

/** Relationship type: Slide layout */
export const REL_SLIDE_LAYOUT =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';

/** Relationship type: Slide master */
export const REL_SLIDE_MASTER =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster';

export const CONTENT_TYPE_XLSX_WORKBOOK =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
