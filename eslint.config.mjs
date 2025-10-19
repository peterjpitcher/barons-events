import nextPlugin from "@next/eslint-plugin-next";

const { configs } = nextPlugin;

export default [
  configs["core-web-vitals"],
  {
    ignores: ["archive_pre_mvp/**"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/jsx-key": "off"
    }
  }
];
