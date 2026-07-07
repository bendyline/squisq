/**
 * DOMParser polyfill for Node.
 *
 * The formats package is browser-pure: its shared OOXML reader
 * (`ooxml/reader.ts`, used by DOCX/PPTX/XLSX import) parses XML with the global
 * `DOMParser`, which browsers and jsdom provide but bare Node does not. The CLI
 * runs in Node, so importing this module for its side effect installs a
 * `@xmldom/xmldom`-backed `DOMParser` on `globalThis` when one is missing.
 *
 * The install is idempotent and gated on absence, so it is a no-op in a browser
 * or once the formats package no longer needs a global parser.
 */

import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';

const globalScope = globalThis as { DOMParser?: unknown };

if (typeof globalScope.DOMParser === 'undefined') {
  // @xmldom/xmldom's DOMParser implements the DOM Level 2 surface the OOXML
  // reader relies on (getElementsByTagName[NS], getAttribute, localName,
  // textContent). Its constructor signature is compatible with the browser's.
  globalScope.DOMParser = XmldomDOMParser as unknown as typeof DOMParser;
}
