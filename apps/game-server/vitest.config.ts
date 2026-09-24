import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "game-server",
    include: ["src/**/*.test.ts"],
  },
});
