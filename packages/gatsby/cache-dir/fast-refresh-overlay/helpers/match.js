// Copied from https://github.com/carbon-design-system/carbon
// License: Apache-2.0
// Copyright IBM Corp. 2016, 2018
// Entrypoint: packages/react/src/internal/keyboard/match.js

/**
 * 渡されたキーが、対応するキーボードイベントと一致するかどうかを確認する。
 * イベントを使えない場合に備えて、値を直接渡すこともできる。
 *
 * @example
 * import * as keys from '../keys';
 * import { matches } from '../match';
 *
 * function handleOnKeyDown(event) {
 *   if (match(event, keys.Enter) {
 *     // ...
 *   }
 * }
 *
 * @param {Event|number|string} eventOrCode
 * @param {Key} key
 * @returns {boolean}
 */
export function match(eventOrCode, { key, which, keyCode } = {}) {
  if (typeof eventOrCode === `string`) {
    return eventOrCode === key
  }

  if (typeof eventOrCode === `number`) {
    return eventOrCode === which || eventOrCode === keyCode
  }

  if (eventOrCode.key && Array.isArray(key)) {
    return key.indexOf(eventOrCode.key) !== -1
  }

  return (
    eventOrCode.key === key ||
    eventOrCode.which === which ||
    eventOrCode.keyCode === keyCode
  )
}
