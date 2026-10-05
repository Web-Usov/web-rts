import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "match-adapter",
    include: ["src/**/*.test.ts"],
  },
});
