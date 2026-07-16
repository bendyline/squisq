import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Preserve each esbuild run's actual input graph for license generation. */
export function bundleLicenseMetadata(packageDir, label) {
  return {
    name: `squisq-license-metadata-${label}`,
    setup(build) {
      build.initialOptions.metafile = true;
      build.onEnd(async (result) => {
        if (result.errors.length > 0 || !result.metafile) return;
        const outputDir = resolve(packageDir, 'dist', '.license-meta');
        await mkdir(outputDir, { recursive: true });
        await writeFile(
          resolve(outputDir, `${label}.json`),
          JSON.stringify(
            {
              absWorkingDir: build.initialOptions.absWorkingDir ?? packageDir,
              inputs: Object.keys(result.metafile.inputs),
            },
            null,
            2,
          ),
          'utf8',
        );
      });
    },
  };
}
