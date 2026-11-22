// import 時点での安全でない組み込みモジュールの使用に備え、ここでグローバルを初期化する
global.unsafeBuiltinUsage = []

function createProxyHandler(prefix, options) {
  return {
    get: function (target, key) {
      const value = target[key]
      const path = key && key.toString ? `${prefix}.${key.toString()}` : prefix

      if (options.ignore.includes(path)) {
        return value
      }

      const fieldDescriptor = Object.getOwnPropertyDescriptor(target, key)
      if (fieldDescriptor && !fieldDescriptor.writable) {
        // 次のようなエラーを防ぐためのもの:
        // ```
        // TypeError: 'get' on proxy: property 'constants' is a read - only and
        // non - configurable data property on the proxy target but the proxy
        // did not return its actual value
        // (expected '[object Object]' but got '[object Object]')
        // ```
        return value
      }

      if (typeof value === `function`) {
        return function wrapper(...args) {
          const myErrorHolder = {
            name: `Unsafe builtin usage ${path}`,
          }
          Error.captureStackTrace(myErrorHolder, wrapper)

          // - loadPageDataSync はすでに専用の警告メッセージで追跡しているので、
          // 同じ使用に対して複数のメッセージが出ないよう、マークを省く
          // - node-gyp-build はバイナリを読み込もうとして fs.readDirSync を使う
          // これは無視して問題ないはずである。
          if (
            !myErrorHolder.stack.includes(`loadPageDataSync`) &&
            !myErrorHolder.stack.includes(`node-gyp-build`)
          ) {
            global.unsafeBuiltinUsage.push(myErrorHolder.stack)
          }

          return value.apply(target, args)
        }
      } else if (typeof value === `object` && value !== null) {
        return new Proxy(value, createProxyHandler(path, options))
      }

      return value
    },
  }
}

function wrapModuleWithTracking(moduleName, options = {}) {
  if (!options.ignore) {
    options.ignore = []
  }

  const mod = require(moduleName)
  return new Proxy(mod, createProxyHandler(moduleName, options))
}

exports.wrapModuleWithTracking = wrapModuleWithTracking
