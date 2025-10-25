import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                "src/panel/panel": resolve(__dirname, "src/panel/panel.html"),
            },
        },
        outDir: "dist",
        emptyOutDir: true, 
    },
    publicDir: "public"
});