import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "game-data",
    include: ["src/**/*.test.ts"],
  },
});
