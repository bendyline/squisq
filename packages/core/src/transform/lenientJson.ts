/**
 * Reading JSON from a model that was asked for it but may not have obeyed.
 *
 * Small and on-device models wrap JSON in code fences, think aloud first, add
 * a sentence after, or stop mid-array when they run out of tokens — and some
 * hosts cannot enforce a reply format at all. These helpers find the JSON a
 * reply holds and, for a reply cut off inside an array, keep the objects it
 * finished.
 */

/** The reply without reasoning blocks or code fences. */
export function stripModelChatter(text: string): string {
  return text
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/giu, '')
    .replace(/```(?:json)?/giu, '')
    .trim();
}

/** Index of the bracket closing the one at `start`, or -1 when the text ends first. */
function closingIndex(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** The first JSON object or array in a reply, or undefined when it holds none. */
export function readLenientJson(text: string): unknown {
  const clean = stripModelChatter(text);
  try {
    return JSON.parse(clean);
  } catch {
    // Look for the first complete object or array inside the text.
  }
  for (let start = 0; start < clean.length; start++) {
    const char = clean[start];
    if (char !== '{' && char !== '[') continue;
    const end = closingIndex(clean, start);
    if (end < 0) continue;
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch {
      // Not JSON from here; keep looking.
    }
  }
  return undefined;
}

/**
 * The complete objects at the start of the first array in a reply — what a
 * reply cut off mid-array managed to finish.
 */
export function salvageJsonObjects(text: string): unknown[] {
  const clean = stripModelChatter(text);
  const open = clean.indexOf('[');
  if (open < 0) return [];
  const found: unknown[] = [];
  for (let at = open + 1; at < clean.length; at++) {
    const char = clean[at];
    if (char === ']') break;
    if (char !== '{') continue;
    const end = closingIndex(clean, at);
    if (end < 0) break;
    try {
      found.push(JSON.parse(clean.slice(at, end + 1)));
    } catch {
      break;
    }
    at = end;
  }
  return found;
}
