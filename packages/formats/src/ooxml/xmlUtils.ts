/**
 * XML Utility Functions
 *
 * Lightweight helpers for generating well-formed XML strings.
 * Used by all OOXML writers (DOCX, PPTX, XLSX) to construct
 * part content without a heavy DOM library.
 */

/**
 * XML declaration for the start of every OOXML part.
 */
export function xmlDeclaration(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

/**
 * Escape a string for safe inclusion in XML text content or attribute values.
 *
 * Handles the five predefined XML entities:
 * - & → &amp;
 * - < → &lt;
 * - > → &gt;
 * - " → &quot;
 * - ' → &apos;
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build an XML attribute string from a key-value record.
 * Only includes entries where the value is defined and non-empty.
 *
 * @example
 * ```ts
 * attrString({ 'w:val': 'Heading1', 'w:eastAsia': undefined })
 * // ' w:val="Heading1"'
 * ```
 */
export function attrString(attrs?: Record<string, string | undefined>): string {
  if (!attrs) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== '') {
      parts.push(` ${key}="${escapeXml(value)}"`);
    }
  }
  return parts.join('');
}

/**
 * Build a self-closing XML element: `<tag attr="val"/>`.
 *
 * @example
 * ```ts
 * selfClosingElement('w:b')
 * // '<w:b/>'
 *
 * selfClosingElement('w:pStyle', { 'w:val': 'Heading1' })
 * // '<w:pStyle w:val="Heading1"/>'
 * ```
 */
export function selfClosingElement(
  tag: string,
  attrs?: Record<string, string | undefined>,
): string {
  return `<${tag}${attrString(attrs)}/>`;
}

/**
 * Build an XML element with children: `<tag attr="val">...children...</tag>`.
 * Children are concatenated directly (no extra whitespace).
 *
 * @example
 * ```ts
 * xmlElement('w:p', {},
 *   xmlElement('w:r', {},
 *     xmlElement('w:t', {}, 'Hello')
 *   )
 * )
 * // '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'
 * ```
 */
export function xmlElement(
  tag: string,
  attrs?: Record<string, string | undefined>,
  ...children: string[]
): string {
  const content = children.join('');
  if (content === '') {
    return selfClosingElement(tag, attrs);
  }
  return `<${tag}${attrString(attrs)}>${content}</${tag}>`;
}

/**
 * Build an XML text element: `<tag attr="val">escaped text</tag>`.
 * The text value is XML-escaped automatically.
 *
 * This is a convenience for the common pattern of wrapping text in an element,
 * where you want automatic escaping (unlike `xmlElement` which takes raw children).
 *
 * @example
 * ```ts
 * textElement('w:t', { 'xml:space': 'preserve' }, 'Hello & world')
 * // '<w:t xml:space="preserve">Hello &amp; world</w:t>'
 * ```
 */
export function textElement(
  tag: string,
  attrs?: Record<string, string | undefined>,
  text?: string,
): string {
  if (text === undefined || text === '') {
    return selfClosingElement(tag, attrs);
  }
  return `<${tag}${attrString(attrs)}>${escapeXml(text)}</${tag}>`;
}
