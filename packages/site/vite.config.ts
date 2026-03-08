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
});
