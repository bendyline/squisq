import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'docx/index': 'src/docx/index.ts',
    'pptx/index': 'src/pptx/index.ts',
    'xlsx/index': 'src/xlsx/index.ts',
    'ooxml/index': 'src/ooxml/index.ts',
    'pdf/index': 'src/pdf/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@bendyline/prodcore', 'jszip', 'pdf-lib', 'pdfjs-dist'],
});
