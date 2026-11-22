import runner from "@babel/helper-plugin-test-runner"

/**
 * `@babel/helper-plugin-test-runner` は、隣の `fixtures` ディレクトリの中のすべてのサブディレクトリを対象に実行される。
 * @see {@link https://babel.dev/docs/en/babel-helper-plugin-test-runner} for docs
 * @see {@link https://github.com/babel/babel/blob/main/packages/babel-helper-plugin-test-runner} for source code
 */
runner(__dirname)
