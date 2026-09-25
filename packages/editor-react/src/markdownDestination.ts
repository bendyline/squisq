/**
 * CommonMark link destinations.
 *
 * A bare destination (`[a](path)`) cannot contain whitespace or unbalanced
 * parentheses; the angle-bracket form (`[a](<my file.zip>)`) can. Attached
 * files routinely have names like `Q3 Report.zip`, so every writer of a link
 * or image destination goes through {@link formatLinkDestination}, and every
 * reader strips the brackets with {@link unwrapLinkDestination}.
 */

function hasUnbalancedParens(url: string): boolean {
  let depth = 0;
  for (let i = 0; i < url.length; i++) {
    if (url[i] === '\\') {
      i++;
      continue;
    }
    if (url[i] === '(') depth++;
    else if (url[i] === ')' && --depth < 0) return true;
  }
  return depth !== 0;
}

/** Whether `url` needs the angle-bracket form to be one destination. */
export function needsAngleDestination(url: string): boolean {
  return /\s/.test(url) || hasUnbalancedParens(url);
}

/** `url` as a destination: bare when CommonMark allows it, else `<url>`. */
export function formatLinkDestination(url: string): string {
  return needsAngleDestination(url) ? `<${url}>` : url;
}

/** The URL inside a destination, without its angle brackets. */
export function unwrapLinkDestination(destination: string): string {
  return destination.length >= 2 && destination.startsWith('<') && destination.endsWith('>')
    ? destination.slice(1, -1)
    : destination;
}

/** Escape text for a link label or image alt, where brackets are syntax. */
export function escapeLinkLabel(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1');
}
