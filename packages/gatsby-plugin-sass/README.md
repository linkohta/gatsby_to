# gatsby-plugin-sass

Provides drop-in support for Sass/SCSS stylesheets

## Install

`npm install sass gatsby-plugin-sass`

## How to use

1. Include the plugin in your `gatsby-config.js` file.

```javascript:title=gatsby-config.js
plugins: [`gatsby-plugin-sass`]
```

2. Write your stylesheets in Sass/SCSS and require or import them as normal.

```scss:title=src/index.scss
html {
  background-color: rebeccapurple;
  p {
    color: white;
  }
}
```

```javascript:title=gatsby-browser.js
import "./src/index.scss"
```

## Other options

If you need to pass options to Sass use the plugins options, see the [Sass JavaScript API docs](https://sass-lang.com/documentation/js-api/interfaces/options/)
for all available options.

```javascript:title=gatsby-config.js
plugins: [
  {
    resolve: `gatsby-plugin-sass`,
    options: {
      sassOptions: {
        loadPaths: ["absolute/path/a", "absolute/path/b"],
        ...
      }
    },
  },
]
```

If you need to override the default [CSS Modules options](https://github.com/webpack-contrib/css-loader#modules) passed into [`css-loader`](https://github.com/webpack-contrib/css-loader), use `cssLoaderOptions.modules`.
**Note:** Gatsby is using `css-loader@^7.1.5`. Only the `modules` option of `cssLoaderOptions` is passed to `css-loader`; other keys are ignored.

```javascript:title=gatsby-config.js
plugins: [
  {
    resolve: `gatsby-plugin-sass`,
    options: {
      cssLoaderOptions: {
        modules: {
          exportLocalsConvention: `camelCaseOnly`,
        },
      },
    },
  },
]
```

### additionalData

Prepends Sass code before the actual entry file. In this case, the `sass-loader` will not override the data option but just prepend the entry's content. You might use this to prepend things like environmental variables (as Sass variables) or even prepend a global Sass import to be used in other Sass files (functions, mixins, variables, etc.).

See [webpack's sass-loader documentation](https://webpack.js.org/loaders/sass-loader/#additionaldata) for reference.

```javascript:title=gatsby-config.js
plugins: [
  {
    resolve: `gatsby-plugin-sass`,
    options: {
      additionalData: "$env: " + process.env.NODE_ENV + ";",
    },
  },
]
```

### Alternative Sass Implementations

By default, [`sass-embedded`](https://github.com/sass/embedded-host-node) is used when it is installed, otherwise the Dart implementation of Sass (`sass`). To use a specific implementation, pass it into the options as the implementation:

```shell
npm install sass-embedded
```

```javascript:title=gatsby-config.js
plugins: [
  {
    resolve: `gatsby-plugin-sass`,
    options: {
      implementation: require("sass-embedded"),
    },
  },
]
```

`node-sass` is not supported anymore.

### With CSS Modules

Using CSS Modules requires no additional configuration. Simply prepend `.module` to the extension. For example: `app.scss` -> `app.module.scss`.
Any file with the `module` extension will use CSS Modules. CSS modules are imported as ES Modules to support treeshaking. You'll need to import styles as: `import { yourClassName, anotherClassName } from './app.module.scss'`

## Sass & CSS Modules file Regexes

To override the file regex for Sass or CSS modules,

```javascript:title=gatsby-config.js
plugins: [
  {
    resolve: `gatsby-plugin-sass`,
    options: {
      // Override the file regex for Sass
      sassRuleTest: /\.global\.s(a|c)ss$/,
      // Override the file regex for CSS modules
      sassRuleModulesTest: /\.mod\.s(a|c)ss$/,
    },
  },
]
```

### PostCSS plugins

PostCSS is also included to handle some default optimizations like autoprefixing
and common cross-browser flexbox bugs. Normally you don't need to think about it, but if
you'd prefer to add additional postprocessing to your Sass output you can specify plugins
in the plugin options.

## Relative paths & `url()`

This plugin resolves `url()` paths relative to the entry SCSS/Sass file not – as might be expected – the location relative to the declaration. Under the hood, it makes use of [`sass-loader`](https://github.com/webpack-contrib/sass-loader/blob/master/README.md#problems-with-url) and this is documented in the [readme](https://github.com/webpack-contrib/sass-loader/blob/master/README.md#problems-with-url).

Using [`resolve-url-loader`](https://github.com/bholloway/resolve-url-loader) provides a workaround, if you want to use relative url just install the plugin and then add it to your Sass plugin options configuration.

First:

```shell
npm install resolve-url-loader --save-dev
```

And then:

```javascript:title=gatsby-config.js
plugins: [
  {
    resolve: "gatsby-plugin-sass",
    options: {
      useResolveUrlLoader: true,
    },
  },
]
```

You can also configure `resolve-url-plugin` providing some options (see [plugin documentation](https://github.com/bholloway/resolve-url-loader) for all options):

```javascript:title=gatsby-config.js
plugins: [
  {
    resolve: "gatsby-plugin-sass",
    options: {
      useResolveUrlLoader: {
        options: {
          debug: true,
        },
      },
    },
  },
]
```

**Please note:** Adding `resolve-url-loader` will use `sourceMap: true` on `sass-loader` (as it is required for the plugin to work), you can then activate/deactivate source-map for Sass files in the plugin:

```javascript:title=gatsby-config.js
plugins: [
  {
    resolve: "gatsby-plugin-sass",
    options: {
      useResolveUrlLoader: {
        options: {
          sourceMap: true, //default is false
        },
      },
    },
  },
]
```

## Breaking changes history

<!-- Please keep the breaking changes list ordered with the newest change at the top -->

### sass-loader 17

- `sass-loader` is updated to v17, which only supports the modern Sass JavaScript API. `node-sass` and the options of the legacy API are not supported anymore. Rename the options in `sassOptions` as follows: `includePaths` to `loadPaths`, `outputStyle` to `style`, `indentedSyntax` to `syntax` and `importer` to `importers` (the signature of importers and custom functions also changed, see the [Sass JavaScript API docs](https://sass-lang.com/documentation/js-api/interfaces/options/)). Other options of the legacy API such as `precision` are ignored.
- `sass` 1.45.0 or later is required.
- `resolve-url-loader` is updated to v5. The `engine` option was removed.

### v3.0.0

- `sass-loader` is updated to v10 which adds support for `node-sass@^5.0.0` but also switches the default `implementation` to `sass`. webpack also recommends using `sass` so this is reflected in the documentation here, too. In the [deprecation notice of node-sass](https://sass-lang.com/blog/libsass-is-deprecated#how-do-i-migrate) it is noted that switching from `node-sass` to `sass` is straightforward as both packages use the same JavaScript API.
- All options for both [`node-sass`](https://github.com/sass/node-sass#options) & [`sass`](https://github.com/sass/dart-sass/blob/master/README.md#javascript-api) are moved into the `sassOptions` object
- You're now able to override the `importLoaders` option. If you have this in your options but don't intend to override it, you'll need to remove it

### v2.0.0

- `node-sass` is moved to a peer dependency. Installing the package
  alongside `gatsby-plugin-sass` is now required. Use `npm install node-sass`

- support Gatsby v2 only
