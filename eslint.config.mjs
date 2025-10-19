import nextPlugin from "@next/eslint-plugin-next";

const { configs } = nextPlugin;

export default [
  configs["core-web-vitals"],
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/jsx-key": "off"
    }
  }
];
