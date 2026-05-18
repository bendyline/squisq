/**
 * Collect FontAwesome `@font-face` + utility CSS rules from the host
 * document's loaded stylesheets so we can inline them into a sandboxed
 * iframe preview.
 *
 * Why: an iframe rendered via `srcDoc` cannot reliably load
 * FontAwesome from a cross-origin CDN. Tracking prevention, stricter
 * origin policies, and the iframe's about:srcdoc origin all conspire
 * to silently drop font fetches. The icons end up invisible even
 * though the `<i class="fa-…">` tags are present in the markup. The
 * host page (editor-react ships a bundled `@import` of
 * `@fortawesome/fontawesome-free`) already has the font loaded and its
 * woff2 URLs resolve to same-origin assets, so we extract those rules
 * once and pass them into the renderer as inline CSS.
 *
 * Returns `undefined` when no FA rules are found — typical for SSR or
 * for hosts that don't bundle FA — in which case the renderer falls
 * back to its cdnjs `<link>` (still works in plain standalone HTML).
 */
export function collectInlineFontAwesomeCss(): string | undefined {
  if (typeof document === 'undefined') return undefined;

  const collected: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheets throw on `.cssRules` access. We can't
      // read them, but they're also not where editor-react's bundled
      // FA lives, so it's safe to skip them.
      continue;
    }
    if (!rules) continue;

    for (const rule of Array.from(rules)) {
      if (isFontAwesomeRule(rule)) {
        collected.push(rule.cssText);
      }
    }
  }

  return collected.length > 0 ? collected.join('\n') : undefined;
}

/**
 * Match `@font-face` declarations whose family starts with
 * "Font Awesome", plus the FA utility classes (the `.fa-*` rules that
 * set `content: "\fXXX"` and font-family). The former gets the woff2
 * loaded into the iframe, the latter wires the `<i>` markup to it.
 */
function isFontAwesomeRule(rule: CSSRule): boolean {
  const text = rule.cssText;
  // `@font-face { font-family: "Font Awesome 6 Brands"; … }`
  if (rule.type === CSSRule.FONT_FACE_RULE) {
    return /font-family:\s*['"]?Font Awesome/i.test(text);
  }
  // `.fa-github::before { content: "\f09b"; }` and the base
  // `.fa-brands { font-family: "Font Awesome 6 Brands"; … }` rules.
  // FA's stylesheet prefixes selectors with `.fa`, `.fas`, `.far`,
  // `.fab`, `.fa-solid`, `.fa-regular`, `.fa-brands`. Match the
  // family name in the declaration block to avoid false positives
  // (e.g. someone else's `.fa-…` class that doesn't use the font).
  if (rule.type === CSSRule.STYLE_RULE) {
    return /Font Awesome/i.test(text) || /content:\s*["']\\[ef]/.test(text);
  }
  return false;
}
