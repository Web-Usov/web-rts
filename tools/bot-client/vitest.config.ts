import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "bot-client",
    include: ["src/**/*.test.ts"],
  },
});
