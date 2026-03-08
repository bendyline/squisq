import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Ensure workspace packages resolve to their source
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5199,
    strictPort: true,
    open: true,
  },
  // Optimise monaco-editor: tell Vite to pre-bundle it so workers are served
  // from the local dev server instead of CDN.
  optimizeDeps: {
    include: ['monaco-editor'],
  },
});
