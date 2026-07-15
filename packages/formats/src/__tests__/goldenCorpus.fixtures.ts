import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

async function zipParts(parts: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(parts)) zip.file(path, content);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

function rootRelationships(target: string): string {
  return `${XML}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/officeDocument" Target="${target}"/></Relationships>`;
}

export function buildIndependentDocx(): Promise<ArrayBuffer> {
  return zipParts({
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels': rootRelationships('word/document.xml'),
    'word/_rels/document.xml.rels':
      `${XML}<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rIdStyles" Type="${OFFICE_REL_NS}/styles" Target="styles.xml"/>` +
      '</Relationships>',
    'word/styles.xml':
      `${XML}<w:styles xmlns:w="${WML_NS}">` +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '</w:styles>',
    'word/document.xml':
      `${XML}<w:document xmlns:w="${WML_NS}"><w:body>` +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly field report</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Revenue grew </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>42 percent</w:t></w:r><w:r><w:t xml:space="preserve"> in São Paulo.</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Units</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1,024</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:sectPr/></w:body></w:document>',
  });
}

export function buildIndependentPptx(): Promise<ArrayBuffer> {
  return zipParts({
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
      '</Types>',
    '_rels/.rels': rootRelationships('ppt/presentation.xml'),
    'ppt/presentation.xml':
      `${XML}<p:presentation xmlns:p="${PRESENTATION_NS}" xmlns:r="${OFFICE_REL_NS}">` +
      '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': `${XML}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/slide" Target="slides/slide1.xml"/></Relationships>`,
    'ppt/slides/slide1.xml':
      `${XML}<p:sld xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}"><p:cSld><p:spTree>` +
      '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Quarterly field report</a:t></a:r></a:p></p:txBody></p:sp>' +
      '<p:sp><p:txBody><a:p><a:r><a:t>First finding</a:t></a:r></a:p><a:p><a:r><a:t>Second finding</a:t></a:r></a:p></p:txBody></p:sp>' +
      '</p:spTree></p:cSld></p:sld>',
  });
}

export function buildIndependentXlsx(): Promise<ArrayBuffer> {
  return zipParts({
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '</Types>',
    '_rels/.rels': rootRelationships('xl/workbook.xml'),
    'xl/workbook.xml': `${XML}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_REL_NS}"><sheets><sheet name="Operations" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `${XML}<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rId1" Type="${OFFICE_REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${OFFICE_REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rId3" Type="${OFFICE_REL_NS}/styles" Target="styles.xml"/>` +
      '</Relationships>',
    'xl/sharedStrings.xml': `${XML}<sst xmlns="${SPREADSHEET_NS}"><si><t>Region</t></si><si><t>Start</t></si><si><t>Zip</t></si><si><t>North</t></si></sst>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${SPREADSHEET_NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="00000"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml':
      `${XML}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>` +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="1"><v>45292</v></c><c r="C2" s="2"><v>123</v></c></row>' +
      '</sheetData></worksheet>',
  });
}

export async function buildIndependentPdf(): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('Quarterly Field Report', { x: 54, y: 720, size: 24, font });
  page.drawText('Revenue grew 42 percent', { x: 54, y: 680, size: 12, font });
  page.drawText('Measured twice before publication.', { x: 54, y: 660, size: 12, font });
  const bytes = await pdf.save({ useObjectStreams: false });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
