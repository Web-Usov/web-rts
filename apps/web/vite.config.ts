import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL("./index.html", import.meta.url)),
        meshy: fileURLToPath(new URL("./meshy/index.html", import.meta.url)),
      },
    },
  },
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
