---
title: Using ESLint
---

ESLint is an open source JavaScript linting utility. Code linting is a type of static analysis that is frequently used to find problematic patterns. There are code linters for most programming languages, and compilers sometimes incorporate linting into the compilation process.

JavaScript, being a dynamic and loosely-typed language, is especially prone to developer error. Without the benefit of a compilation process, JavaScript code is typically executed in order to find syntax or other errors. Linting tools like ESLint allow developers to discover problems with their JavaScript code without executing it.

## How to use ESLint

Gatsby ships with a built-in [ESLint](https://eslint.org) setup. For _most_ users, our built-in ESLint setup is all you need. If you know however that you'd like to customize your ESLint config e.g. your company has their own custom ESLint setup, this shows how this can be done.

The built-in setup uses ESLint 9 and its [flat config format](https://eslint.org/docs/latest/use/configure/configuration-files). The rules come from the [ESLint config Gatsby ships with](https://github.com/linkohta/gatsby_to/blob/master/packages/gatsby/src/utils/eslint-config.ts), which contains the rules of `eslint-config-react-app` (see [`react-app-rules.ts`](https://github.com/linkohta/gatsby_to/blob/master/packages/gatsby/src/utils/eslint/react-app-rules.ts)) plus accessibility rules from `eslint-plugin-jsx-a11y`. The `eslint-config-react-app` package itself is no longer used, because it only supports the older `.eslintrc` format.

To set up your own config, install ESLint and the plugins you'd like to use. The example below uses the React, React Hooks, and accessibility plugins that Gatsby's built-in setup is also based on.

```shell
# First install the necessary ESLint dependencies
npm install --save-dev eslint@9 @eslint/js@9 globals eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-jsx-a11y
```

Now that your packages have been installed, create a new file at the root of the site named `eslint.config.js` using the command below.

```shell
# Create a config file for ESLint
touch eslint.config.js
```

### Configuring ESLint

Copy the snippet below to the newly created `eslint.config.js` file. Then add additional presets, plugins, and rules as desired.

```js:title=eslint.config.js
const js = require("@eslint/js")
const globals = require("globals")
const react = require("eslint-plugin-react")
const reactHooks = require("eslint-plugin-react-hooks")
const jsxA11y = require("eslint-plugin-jsx-a11y")

module.exports = [
  // The flat config format doesn't skip dotfiles by default, so ignore Gatsby's output
  { ignores: [".cache/", "public/"] },
  js.configs.recommended,
  react.configs.flat.recommended,
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        __PATH_PREFIX__: "readonly",
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
]
```

You can now run `npx eslint .` to lint your site, and editors with an ESLint integration will pick up the file.

**Note:** When there is no ESLint config file Gatsby implicitly adds a barebones ESLint setup to its webpack config. This setup pipes ESLint feedback into the terminal window where you are running `gatsby develop` and also to the console in your browser developer tools. This gives you consolidated, immediate feedback on newly-saved files. When you include a custom ESLint config (an `eslint.config.js` file, a legacy `.eslintrc` file, or an `eslintConfig` key in your `package.json`), Gatsby gives you control over the ESLint configuration. This means that it will override the built-in setup only leaving the required rules activated (`gatsby/no-anonymous-exports-page-templates` & `gatsby/limited-exports-page-templates`). Gatsby doesn't read your config file, so your own rules won't show up in the terminal output of `gatsby develop` or in the browser console. Run ESLint yourself (e.g. with `npx eslint .` or through your editor) to see them. The Community plugin [`gatsby-plugin-eslint`](/plugins/gatsby-plugin-eslint/) can bring your rules back into `gatsby develop`, but at the time of writing it only declares support for ESLint 7 and 8. This also means that the default [ESLint config Gatsby ships with](https://github.com/linkohta/gatsby_to/blob/master/packages/gatsby/src/utils/eslint-config.ts) (the `eslintConfig` export) will be entirely overwritten. If you would still like to take advantage of those rules, you'll need to copy them to your local file.

### Disabling ESLint

Creating an `eslint.config.js` file that exports an empty array (`module.exports = []`) at the root of your project will mostly disable ESLint for your site. The file will disable the built-in setup because Gatsby assumes once you have an ESLint file you are in charge of linting. However, the required ESLint rules for [Fast Refresh](/docs/reference/local-development/fast-refresh) (`gatsby/no-anonymous-exports-page-templates` & `gatsby/limited-exports-page-templates`) will still be activated and shown in the terminal output.
