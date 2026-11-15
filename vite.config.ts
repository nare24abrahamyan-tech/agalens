import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Static, relative-path build: works on Netlify (or any static host) with no server.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
