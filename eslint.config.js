// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/src/db/migrations/**",
      "**/*.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // The only plain-JS file in the repo — everything else is TypeScript,
    // where typescript-eslint's recommended config turns `no-undef` off and
    // leaves that check to the compiler. This one runs in a service worker's
    // global scope, not a browser page's, so nothing else declares `self`.
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      globals: { self: "readonly" },
    },
  },
);
