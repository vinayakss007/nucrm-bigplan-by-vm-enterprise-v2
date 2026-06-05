import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Global ignores — must be in a standalone object (with only `ignores`)
  // for flat config to treat them as global. Combining `ignores` with other
  // keys (files/rules) does NOT globally ignore, which previously caused the
  // generated `.next/` output to be linted.
  {
    ignores: [
      "node_modules/",
      ".next/",
      "out/",
      "coverage/",
      "storybook-static/",
      "playwright-report/",
      "test-results/",
      "drizzle/migrations/",
      "public/",
      "next-env.d.ts",
      "**/*.stories.tsx",
      "tests/load/",
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Test and standalone CLI scripts are dev-only tooling (not part of the
    // production build). They legitimately use CommonJS require() for dynamic
    // module loading (e.g. loading a module after setting env vars in a test)
    // and occasionally need broad ts-suppression. Relax those rules here.
    files: ["tests/**/*.{js,ts,tsx}", "scripts/**/*.{js,ts}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  }
);
