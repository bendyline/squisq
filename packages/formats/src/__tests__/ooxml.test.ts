/**
 * Tests for the shared OOXML layer: xmlUtils, writer, reader round-trips.
 */

import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  xmlElement,
  selfClosingElement,
  textElement,
  attrString,
  xmlDeclaration,
} from '../ooxml/xmlUtils';
import { createPackage } from '../ooxml/writer';
import { openPackage, getPartXml, getCoreProperties, getPartRelationships } from '../ooxml/reader';
import { REL_OFFICE_DOCUMENT } from '../ooxml/namespaces';

// ============================================
// XML Utilities
// ============================================

describe('escapeXml', () => {
  it('escapes all five XML entities', () => {
    expect(escapeXml('a & b < c > d " e \' f')).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeXml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });
});

describe('attrString', () => {
  it('builds attribute string from object', () => {
    const result = attrString({ 'w:val': 'Heading1' });
    expect(result).toBe(' w:val="Heading1"');
  });

  it('omits undefined values', () => {
    const result = attrString({ 'w:val': 'test', 'w:other': undefined });
    expect(result).toBe(' w:val="test"');
  });

  it('returns empty string for empty attrs', () => {
    expect(attrString({})).toBe('');
    expect(attrString(undefined)).toBe('');
  });
});

describe('selfClosingElement', () => {
  it('builds self-closing tag', () => {
    expect(selfClosingElement('w:b')).toBe('<w:b/>');
  });

  it('includes attributes', () => {
    expect(selfClosingElement('w:pStyle', { 'w:val': 'Heading1' })).toBe(
      '<w:pStyle w:val="Heading1"/>',
    );
  });
});

describe('xmlElement', () => {
  it('builds element with children', () => {
    expect(xmlElement('w:p', {}, 'content')).toBe('<w:p>content</w:p>');
  });

  it('self-closes when no children', () => {
    expect(xmlElement('w:p', {})).toBe('<w:p/>');
  });

  it('concatenates multiple children', () => {
    expect(xmlElement('w:p', {}, 'a', 'b')).toBe('<w:p>ab</w:p>');
  });
});

describe('textElement', () => {
  it('escapes text content', () => {
    expect(textElement('w:t', {}, 'a & b')).toBe('<w:t>a &amp; b</w:t>');
  });

  it('self-closes when no text', () => {
    expect(textElement('w:t', {})).toBe('<w:t/>');
  });
});

describe('xmlDeclaration', () => {
  it('returns standard XML declaration', () => {
    expect(xmlDeclaration()).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    );
  });
});

// ============================================
// Package Writer + Reader Round-Trip
// ============================================

describe('createPackage / openPackage round-trip', () => {
  it('creates a valid ZIP with content types and parts', async () => {
    const pkg = createPackage();
    pkg.addPart(
      'word/document.xml',
      '<w:document><w:body/></w:document>',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    );
    pkg.addRelationship('', {
      id: 'rId1',
      type: REL_OFFICE_DOCUMENT,
      target: 'word/document.xml',
    });

    const arrayBuffer = await pkg.toArrayBuffer();
    expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(arrayBuffer.byteLength).toBeGreaterThan(0);

    // Read it back
    const opened = await openPackage(arrayBuffer);
    expect(opened.zip).toBeDefined();
    expect(opened.contentTypes.overrides.has('word/document.xml')).toBe(true);
    expect(opened.rootRelationships.length).toBeGreaterThanOrEqual(1);
    expect(opened.rootRelationships[0].type).toBe(REL_OFFICE_DOCUMENT);
  });

  it('round-trips XML part content', async () => {
    const pkg = createPackage();
    const testXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><root><child attr="value">text</child></root>';
    pkg.addPart('test/data.xml', testXml, 'application/xml');

    const buffer = await pkg.toArrayBuffer();
    const opened = await openPackage(buffer);
    const doc = await getPartXml(opened, 'test/data.xml');

    expect(doc).not.toBeNull();
    const child = doc!.getElementsByTagName('child')[0];
    expect(child.getAttribute('attr')).toBe('value');
    expect(child.textContent).toBe('text');
  });

  it('round-trips core properties', async () => {
    const pkg = createPackage();
    pkg.addPart('word/document.xml', '<doc/>', 'application/xml');
    pkg.setCoreProperties({
      title: 'Test Title',
      creator: 'Test Author',
      description: 'Test description with <special> & chars',
    });

    const buffer = await pkg.toArrayBuffer();
    const opened = await openPackage(buffer);
    const props = await getCoreProperties(opened);

    expect(props.title).toBe('Test Title');
    expect(props.creator).toBe('Test Author');
    expect(props.description).toBe('Test description with <special> & chars');
  });

  it('round-trips part relationships', async () => {
    const pkg = createPackage();
    pkg.addPart('word/document.xml', '<doc/>', 'application/xml');
    pkg.addRelationship('word/document.xml', {
      id: 'rId1',
      type: 'http://example.com/styles',
      target: 'styles.xml',
    });
    pkg.addRelationship('word/document.xml', {
      id: 'rId2',
      type: 'http://example.com/hyperlink',
      target: 'https://example.com',
      targetMode: 'External',
    });

    const buffer = await pkg.toArrayBuffer();
    const opened = await openPackage(buffer);
    const rels = await getPartRelationships(opened, 'word/document.xml');

    expect(rels.length).toBe(2);
    expect(rels[0].id).toBe('rId1');
    expect(rels[0].target).toBe('styles.xml');
    expect(rels[1].id).toBe('rId2');
    expect(rels[1].target).toBe('https://example.com');
    expect(rels[1].targetMode).toBe('External');
  });

  it('handles binary parts', async () => {
    const pkg = createPackage();
    const testData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes
    pkg.addBinaryPart('word/media/image1.png', testData, 'image/png');

    const buffer = await pkg.toArrayBuffer();
    const opened = await openPackage(buffer);

    // Binary part should appear in content types via extension default
    expect(opened.contentTypes.defaults.has('png')).toBe(true);
  });
});
