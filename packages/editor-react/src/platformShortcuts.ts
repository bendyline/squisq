function resolvePlatform(explicitPlatform?: string): string {
  if (explicitPlatform !== undefined) return explicitPlatform;
  if (typeof navigator === 'undefined') return '';
  return navigator.platform;
}

/** Format a single-key editor shortcut for the user's operating system. */
export function platformShortcut(key: string, platform?: string): string {
  return /Mac|iPhone|iPad|iPod/i.test(resolvePlatform(platform)) ? `⌘${key}` : `Ctrl+${key}`;
}
