import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                // The side panel HTML page
                panel: resolve(__dirname, "src/panel/panel.html"),
                // The background script (service worker)
                background: resolve(__dirname, "src/background.js"),
                content: resolve(__dirname, "src/content.js"),
            },
            output: {
                // Ensure background.js and content.js are not bundled into assets
                entryFileNames: (chunk) => {
                    if (chunk.name === "background" || chunk.name === "content") {
                        return "[name].js"; // Keep in the root of dist
                    }
                    return "assets/[name].js"; // Default for other files
                },
            },
        },
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: true,
    },
    publicDir: "public",
});
