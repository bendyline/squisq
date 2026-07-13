import { describe, expect, it } from 'vitest';
import * as root from '../index';
import * as icons from '../icons/index';
import * as schemas from '../schemas/index';
import * as transform from '../transform/index';

const transformRuntimeExports = [
  'applyTransform',
  'resolveTransformStyle',
  'getTransformStyleIds',
  'getTransformStyleSummaries',
  'createTransformStyleRegistry',
  'DEFAULT_TRANSFORM_STYLE_ID',
  'analyzeBlocks',
  'extractDocImages',
] as const;

const iconRuntimeExports = [
  'ICONS',
  'resolveIcon',
  'canonicalIconToken',
  'looksLikeIconToken',
  'suggestIcons',
  'iconGlyph',
] as const;

function expectReExported(
  rootExports: Record<string, unknown>,
  subpathExports: Record<string, unknown>,
  names: readonly string[],
): void {
  for (const name of names) {
    expect(rootExports[name], `root barrel should re-export ${name}`).toBe(subpathExports[name]);
  }
}

describe('root barrel exports', () => {
  it('re-exports transform runtime APIs', () => {
    expectReExported(root, transform, transformRuntimeExports);
  });

  it('re-exports icon runtime APIs', () => {
    expectReExported(root, icons, iconRuntimeExports);
  });

  it('does not publish process-global registry mutators', () => {
    for (const name of [
      'registerTheme',
      'unregisterTheme',
      'getRegisteredThemes',
      'lookupRegisteredTheme',
    ]) {
      expect(root).not.toHaveProperty(name);
      expect(schemas).not.toHaveProperty(name);
    }
    for (const name of ['registerTransformStyle', 'unregisterTransformStyle']) {
      expect(root).not.toHaveProperty(name);
      expect(transform).not.toHaveProperty(name);
    }
  });
});
