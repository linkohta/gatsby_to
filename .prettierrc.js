module.exports = {
  arrowParens: "avoid",
  semi: false,
  // Prettier 3 で既定値が "all" に変わったので、これまでの書式を保つために明示する
  trailingComma: "es5",
  overrides: [
    {
      // This file uses semicolons. It's needed here because `documentation`
      // package (used to parse jsdoc and provide content for API reference pages)
      // behaviour is inconsistent when not using semicolons after
      // object declarations.
      files: ["**/api-node-helpers-docs.js"],
      options: {
        semi: true,
      },
    },
    {
      files: "docs/**/*.md",
      options: {
        parser: "mdx",
      },
    },
  ],
}
