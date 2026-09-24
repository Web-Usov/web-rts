import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "simulation",
    include: ["src/**/*.test.ts"],
  },
});
