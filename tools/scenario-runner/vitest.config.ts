import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "scenario-runner",
    include: ["src/**/*.test.ts"],
  },
});
