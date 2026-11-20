import js from "@eslint/js";
export default [
  {
    ignores: ["bench/**", "cost/**", "public/**", "dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
];
