import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootEntry = pathToFileURL(resolve('packages/core/dist/index.js')).href;
const schemasEntry = pathToFileURL(resolve('packages/core/dist/schemas/index.js')).href;
const transformEntry = pathToFileURL(resolve('packages/core/dist/transform/index.js')).href;

describe('published explicit registry APIs', () => {
  it('keeps custom themes caller-owned and removes global theme mutation', async () => {
    const [root, schemas] = await Promise.all([import(rootEntry), import(schemasEntry)]);
    const custom = schemas.compileTheme({
      id: 'tenant-brand',
      name: 'Tenant Brand',
      seedColors: { primary: '#6633cc' },
    });
    const tenant = schemas.createThemeRegistry([custom]);

    expect(schemas.resolveTheme('tenant-brand', tenant).name).toBe('Tenant Brand');
    expect(schemas.resolveTheme('tenant-brand').id).not.toBe('tenant-brand');
    expect(Object.isFrozen(tenant.get('tenant-brand'))).toBe(true);
    for (const name of [
      'registerTheme',
      'unregisterTheme',
      'getRegisteredThemes',
      'lookupRegisteredTheme',
    ]) {
      expect(root).not.toHaveProperty(name);
      expect(schemas).not.toHaveProperty(name);
    }
  });

  it('accepts explicit transform registries and only canonical built-in ids', async () => {
    const [root, transform] = await Promise.all([import(rootEntry), import(transformEntry)]);
    const minimal = transform.resolveTransformStyle('minimal');
    const custom = {
      ...minimal,
      id: 'tenant-transform',
      name: 'Tenant Transform',
    };
    const tenant = transform.createTransformStyleRegistry([custom]);

    expect(transform.resolveTransformStyle('tenant-transform', tenant).name).toBe(
      'Tenant Transform',
    );
    expect(transform.resolveTransformStyle('tenant-transform').id).toBe('documentary');
    expect(transform.resolveTransformStyle('data-driven').id).toBe('data-driven');
    expect(transform.resolveTransformStyle('dataDriven').id).toBe('data-driven');
    expect(transform.getTransformStyleIds()).not.toContain('dataDriven');
    for (const name of ['registerTransformStyle', 'unregisterTransformStyle']) {
      expect(root).not.toHaveProperty(name);
      expect(transform).not.toHaveProperty(name);
    }
  });
});
