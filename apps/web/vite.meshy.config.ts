import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Pages publishes the standalone asset tool; the RTS requires a game server.
export default defineConfig({
  root: fileURLToPath(new URL("./meshy", import.meta.url)),
  base: "./",
  build: {
    target: "es2022",
    outDir: fileURLToPath(new URL("./dist-pages/meshy", import.meta.url)),
    emptyOutDir: true,
  },
});
