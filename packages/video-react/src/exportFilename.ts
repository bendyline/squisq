/**
 * File names for saved exports. A host hands over a base name (a document
 * title, or a file name without its extension); these helpers make it safe
 * on every filesystem the file may land on.
 */

/**
 * UTF-8 budget for a base name. Most filesystems cap a name at 255 bytes,
 * and this leaves room for a suffix such as `-dashboard` and the extension.
 */
const MAX_BASE_NAME_BYTES = 200;

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/** Cut text to a UTF-8 byte budget without splitting a character. */
function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += utf8Length(character.codePointAt(0) ?? 0);
    if (bytes > maxBytes) break;
    end += character.length;
  }
  return text.slice(0, end);
}

/**
 * Make a base name safe for a file name. Whitespace runs (line breaks
 * included) become one space, characters Windows rejects and other control
 * characters (DEL too) become `-`, the result is cut to fit the byte budget, and
 * surrounding spaces and trailing dots are dropped. Nothing is treated as an
 * extension, so a title such as `Plan v2.1` keeps its `.1`. Returns
 * undefined when nothing usable is left.
 */
export function exportFileBaseName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const safe = name
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? '-' : character;
    })
    .join('')
    .trim();
  return truncateUtf8(safe, MAX_BASE_NAME_BYTES).replace(/[. ]+$/g, '') || undefined;
}
