import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "game-server-integration",
    include: ["src/integration/**/*.integration.test.ts"],
    // Colyseus test boot binds a fixed port when given a Server instance.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
