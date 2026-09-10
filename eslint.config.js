// Minimal ESLint setup, added to formalize conventions the codebase already
// follows by hand (see CLAUDE.md analysis) rather than to enforce new ones.
// Deliberately curated instead of spreading eslint-plugin-react-hooks'
// "recommended" preset: that preset (v7+) bundles React Compiler-oriented
// rules (purity, immutability, set-state-in-render, ...) this project was
// never written against, which would surface as noise, not real bugs.
// Only the two well-established hooks rules are enabled.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...react.configs.flat.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/prop-types": "off",
      // Narrative Italian UI text is full of literal apostrophes ("l'accesso",
      // "l'ultima modifica"); this rule treats every one as a lint error for
      // no real benefit here.
      "react/no-unescaped-entities": "off",
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_",
      }],
    },
    settings: { react: { version: "detect" } },
  },
  {
    files: ["scripts/**/*.js", "tests/**/*.js", "playwright.config.js", "vite.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
  },
  {
    ignores: ["dist/**", "node_modules/**", "seed-data/**"],
  },
];
