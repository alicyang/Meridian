// vite.config.js
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  build: {
    // Optional but helpful: set entry points so Vite knows what to bundle.
    rollupOptions: {
      input: {
        // JS entry points
        background: 'src/background.js',
        content: 'src/content.js',
        panel: 'src/panel/panel.html',
        // Note: viewer files are copied as static assets below (no bundling)
      },
      output: {
        // Keep file names stable-ish; optional
        entryFileNames: (chunk) =>
          chunk.name === 'background' || chunk.name === 'content'
            ? '[name].js'
            : 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    // Chrome extension likes relative paths in dist
    sourcemap: true,
    emptyOutDir: true,
  },

  plugins: [
    viteStaticCopy({
      targets: [
        {
          // Copy everything under src/PDF_VIEWER into dist/PDF_VIEWER
          src: 'src/PDF_VIEWER/*',
          dest: 'PDF_VIEWER',
        },
      ],
    }),
  ],
});