import { describe, expect, it } from 'vitest';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeGeneratedLicenseMetadata } from '../scripts/remove-license-metadata.mjs';

async function createFixture(): Promise<{ packageDir: string; metadataDir: string }> {
  const packageDir = await mkdtemp(join(tmpdir(), 'squisq-license-metadata-'));
  const metadataDir = join(packageDir, 'dist', '.license-meta');
  await mkdir(metadataDir, { recursive: true });
  return { packageDir, metadataDir };
}

async function cleanupFixture(packageDir: string, metadataDir: string): Promise<void> {
  try {
    for (const entry of await readdir(metadataDir, { withFileTypes: true })) {
      const entryPath = join(metadataDir, entry.name);
      if (entry.isDirectory()) {
        await rmdir(entryPath);
      } else {
        await unlink(entryPath);
      }
    }
    await rmdir(metadataDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await rmdir(join(packageDir, 'dist'));
  await rmdir(packageDir);
}

describe('removeGeneratedLicenseMetadata', () => {
  it('removes only generated JSON files and their now-empty directory', async () => {
    const { packageDir, metadataDir } = await createFixture();
    try {
      await writeFile(join(metadataDir, 'api.json'), '{}');
      await writeFile(join(metadataDir, 'standalone-light.json'), '{}');

      await removeGeneratedLicenseMetadata(packageDir);

      await expect(lstat(metadataDir)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await cleanupFixture(packageDir, metadataDir);
    }
  });

  it('refuses unexpected files and preserves them for inspection', async () => {
    const { packageDir, metadataDir } = await createFixture();
    const unexpected = join(metadataDir, 'README.txt');
    try {
      await writeFile(unexpected, 'keep me');

      await expect(removeGeneratedLicenseMetadata(packageDir)).rejects.toThrow(
        /Refusing to clean unexpected license metadata entry/,
      );
      await expect(readFile(unexpected, 'utf8')).resolves.toBe('keep me');
    } finally {
      await cleanupFixture(packageDir, metadataDir);
    }
  });

  it('refuses nested directories instead of deleting them recursively', async () => {
    const { packageDir, metadataDir } = await createFixture();
    const unexpected = join(metadataDir, 'nested');
    try {
      await mkdir(unexpected);

      await expect(removeGeneratedLicenseMetadata(packageDir)).rejects.toThrow(
        /Refusing to clean unexpected license metadata entry/,
      );
      await expect(lstat(unexpected)).resolves.toMatchObject({});
    } finally {
      await cleanupFixture(packageDir, metadataDir);
    }
  });
});
