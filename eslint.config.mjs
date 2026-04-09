import nextPlugin from "@next/eslint-plugin-next";
import tsParser from "@typescript-eslint/parser";

const { configs } = nextPlugin;

export default [
  {
    ignores: [".next/**", "node_modules/**", "coverage/**"]
  },
  {
    ...configs["core-web-vitals"],
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/jsx-key": "off"
    }
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/jsx-key": "off"
    }
  }
];
