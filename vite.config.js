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
        viewer: 'src/pdf_viewer/viewer-init.js',
      },
      output: {
        // Keep file names stable-ish; optional
        entryFileNames: (chunk) => {
          if (chunk.name === 'background' || chunk.name === 'content') {
            return '[name].js';
          }
          if (chunk.name === 'viewer') {
            return 'pdf_viewer/[name].js';
          }
          return 'assets/[name].js';
        },
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
          // Copy viewer HTML, CSS, and PDF.js files (excluding viewer-init.js which is bundled)
          src: ['src/pdf_viewer/viewer.html', 'src/pdf_viewer/*.css', 'src/pdf_viewer/*.mjs'],
          dest: 'pdf_viewer',
        },
      ],
    }),
  ],
});