const {
  targets: listOfPolyfillsByTarget, // モジュールごとのターゲットを持つオブジェクト
} = require(`core-js-compat`)({
  // IE11、chrome > 63、safari < 12.1 に必要なポリフィルをすべて取得する
  // これで、レガシー向けとモダン向けの全ポリフィルを網羅した一覧が得られる。
  // core-js は次のような出力を返す:
  //   "es.symbol.match-all": {
  //     "chrome": "64",
  //     "ie": "11",
  //     "safari": "3.1"
  //   },
  //   "es.symbol.replace": {
  //     "ie": "11",
  //     "safari": "3.1"
  //   },
  // この対応表を使えば、es.symbol.match-all のようなモダン向けのポリフィルをすべて除外リストから外せるので、
  // babel-preset-env がユーザーのために引き続きポリフィルを入れられる。
  targets: `IE 11, chrome > 63, safari <= 12.1`,
  filter: /^(es)\./,
})

const listOfLegacyPolyfills = []
Object.keys(listOfPolyfillsByTarget).forEach(polyfill => {
  const targets = listOfPolyfillsByTarget[polyfill]
  // IE に必要なポリフィルの一覧だけを追加する。promise.finally などは除外したくない
  if (!targets.chrome) {
    listOfLegacyPolyfills.push(polyfill)
  }
})

module.exports = {
  // レガシー向けのポリフィルのファイルの中で import される
  LEGACY_POLYFILLS: [
    `features/array/copy-within`,
    `features/array/fill`,
    `features/array/find`,
    `features/array/find-index`,
    `features/array/flat-map`,
    `features/array/flat`,
    `features/array/from`,
    `features/array/includes`,
    `features/array/iterator`,
    `features/array/of`,
    `features/function/has-instance`,
    `features/function/name`,
    `features/map`,
    `features/set`,
    `features/weak-map`,
    `features/weak-set`,
    `features/number/constructor`,
    `features/number/epsilon`,
    `features/number/is-finite`,
    `features/number/is-integer`,
    `features/number/is-nan`,
    `features/number/is-safe-integer`,
    `features/number/max-safe-integer`,
    `features/number/min-safe-integer`,
    `features/object/entries`,
    `features/object/get-own-property-descriptors`,
    `features/object/is`,
    `features/object/keys`,
    `features/object/values`,
    `features/string/code-point-at`,
    `features/string/ends-with`,
    `features/string/from-code-point`,
    `features/string/includes`,
    `features/string/iterator`,
    `features/string/pad-start`,
    `features/string/pad-end`,
    `features/string/raw`,
    `features/string/repeat`,
    `features/string/starts-with`,
    `features/string/trim-start`,
    `features/string/trim-end`,
    `features/reflect`,
    `features/regexp`,
    `features/symbol`,
    `features/promise`,
    `features/dom-collections`,
  ],
  // preset-env が、すでにポリフィル済みの機能を自動ポリフィルの対象から除外するために使う
  CORE_JS_POLYFILL_EXCLUDE_LIST: [
    ...listOfLegacyPolyfills,
    `es.object.assign`,

    // babel-preset-env の判定が十分に厳密ではないので、これらはデフォルトで追加している
    // たとえば .forEach を使っていると、まったく関係がなくてもイテレーターのポリフィルが大量に追加される
    `es.array.iterator`,
    `es.promise`,
    `es.symbol.description`,
    `web.*`,

    // core-js@3.7.0 は、あるバグのために reduce と reduce-right のポリフィルを追加した。こちらはすでに chrome 87 を対象にしているので、そのバグは関係ない
    `es.array.reduce`,
    `es.array.reduce-right`,
  ],
}
