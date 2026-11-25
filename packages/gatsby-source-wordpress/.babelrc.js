module.exports = {
  presets: [
    [
      `babel-preset-gatsby-package`,
      {
        "keepDynamicImports": [
          "./src/utils/fetch-graphql.ts",
          "./src/steps/ingest-remote-schema/build-queries-from-introspection/generate-queries-from-ingestable-types.js"
        ]
      }
    ]
  ],
  plugins: [
    // Babel 8 では loose オプションがなくなった。同じ出力になる assumptions は
    // babel-preset-gatsby-package が指定している
    `@babel/plugin-transform-private-methods`,
    [
      `babel-plugin-module-resolver`,
      {
        alias: {
          "~": `./src`,
        },
      },
    ],
    `@babel/plugin-transform-class-properties`,
    [
      `import-globals`,
      {
        dd: {
          moduleName: `dumper.js`,
          exportName: `dd`,
        },
        dump: {
          moduleName: `dumper.js`,
          exportName: `dump`,
        },
        clipboardy: {
          moduleName: `clipboardy`,
          exportName: `default`,
        },
      },
    ],
  ],
  "overrides": [
    {
      "test": ["**/src/gatsby-browser.ts"],
      "presets": [["babel-preset-gatsby-package", { "browser": true, "esm": true }]]
    }
  ]
}
