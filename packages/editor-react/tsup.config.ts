import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    monaco: 'src/monaco.ts',
    'shell/index': 'src/entries/shell.ts',
    'json-editor/index': 'src/entries/json-editor.ts',
    'image-editor/index': 'src/entries/image-editor.ts',
    'recorder/index': 'src/entries/recorder.ts',
    'teleprompter/index': 'src/entries/teleprompter.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  external: ['react', 'react-dom', '@bendyline/squisq', '@bendyline/squisq-react', 'monaco-editor'],
  // Bundle the React adapter and loader. Keeping them as a runtime dependency
  // makes npm auto-install Monaco (and its nested DOMPurify) even for hosts
  // that never open the raw editor.
  noExternal: ['@monaco-editor/react', '@monaco-editor/loader', 'state-local'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
