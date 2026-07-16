import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'docx/index': 'src/docx/index.ts',
    'pptx/index': 'src/pptx/index.ts',
    'xlsx/index': 'src/xlsx/index.ts',
    'csv/index': 'src/csv/index.ts',
    'ooxml/index': 'src/ooxml/index.ts',
    'pdf/index': 'src/pdf/index.ts',
    'html/index': 'src/html/index.ts',
    'epub/index': 'src/epub/index.ts',
    'container/index': 'src/container/index.ts',
    'registry/index': 'src/registry/index.ts',
    'infer/index': 'src/infer/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
  external: ['@bendyline/squisq', 'jszip', 'pdf-lib', 'pdfjs-dist'],
});
