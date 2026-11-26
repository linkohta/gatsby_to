# gatsby-plugin-preact

Provides drop-in support for replacing React with [Preact](https://preactjs.com/).

While Preact doesn't provide full support for the React ecosystem, it is an
intriguing option for Gatsby sites as it saves ~30kb of JavaScript vs. using
React.

> **Note:** This plugin uses Preact X, any version prior to `v10.0.0` is incompatible with Gatsby v2.

> **Known issue:** `gatsby build` currently fails for sites that use this plugin (`gatsby develop` works). With `preact-render-to-string` 5, which the `peerDependencies` ask for, rendering fails with `renderToPipeableStream is not a function`. With `preact-render-to-string` 6, Gatsby's engine validation rejects `require("node:stream")`, and Preact ends up being bundled twice.

## Install

`npm install gatsby-plugin-preact preact preact-render-to-string`

## How to use

```javascript
// In your gatsby-config.js
plugins: [`gatsby-plugin-preact`]
```
