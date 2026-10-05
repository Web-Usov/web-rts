// @ts-check
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.mjs",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/blob-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["apps/**/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "apps/game-server/src/integration/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@web-rts/simulation",
              importNames: ["World", "createWorld"],
              message:
                "Production apps не читают low-level World (ADR-009, Spec #002 §26.12): используйте MatchRuntime / createMatchRuntime.",
            },
          ],
        },
      ],
    },
  },
);
