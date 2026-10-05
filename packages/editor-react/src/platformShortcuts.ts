function resolvePlatform(explicitPlatform?: string): string {
  if (explicitPlatform !== undefined) return explicitPlatform;
  if (typeof navigator === 'undefined') return '';
  return navigator.platform;
}

/** Format an editor shortcut for the user's operating system. */
export function platformShortcut(key: string, platform?: string): string {
  return /Mac|iPhone|iPad|iPod/i.test(resolvePlatform(platform))
    ? `⌘${key.replace('Shift+', '⇧')}`
    : `Ctrl+${key}`;
}
