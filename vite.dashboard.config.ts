import { defineConfig } from 'vite';

export default defineConfig({
  root: 'dashboard',
  base: '/',
  build: {
    outDir: '../dist/dashboard/ui',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/dashboard.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: ({ names }) => {
          const name = names[0] ?? 'asset';
          if (name.endsWith('.css')) return 'assets/dashboard.css';
          if (name.endsWith('.woff2')) return 'assets/instrument-sans-latin.woff2';
          return 'assets/[name][extname]';
        },
      },
    },
  },
});