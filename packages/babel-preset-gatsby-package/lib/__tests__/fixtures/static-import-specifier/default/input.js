export function staticSpecifier() {
  return import(`path`)
}

export function withMagicComment() {
  return import(/* webpackChunkName: "some-chunk" */ `path`)
}

export function stringLiteral() {
  return import("path")
}

export function dynamicSpecifier(name) {
  return [import(`./${name}`), import(name)]
}
