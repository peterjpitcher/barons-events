import nextPlugin from "@next/eslint-plugin-next";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

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
    plugins: {
      // Registered so `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
      // directives can find the rule definition. We don't enforce the rule
      // itself — explicit `any` is intentionally allowed in
      // schema-drift / dynamic-query paths and the disable comments document
      // each use.
      "@typescript-eslint": tsPlugin
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/jsx-key": "off",
      "@typescript-eslint/no-explicit-any": "off"
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
