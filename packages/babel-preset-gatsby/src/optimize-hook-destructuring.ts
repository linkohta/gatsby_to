import type {
  NodePath,
  PluginObject,
  Visitor,
  types as BabelTypes,
} from "@babel/core"

// フックらしい名前のものすべてに一致する（デフォルト）
const isHook = /^use[A-Z]/

// React などが提供する組み込みのフックだけに一致する
const isBuiltInHook =
  /^use(Callback|Context|DebugValue|Effect|ImperativeHandle|LayoutEffect|Memo|Reducer|Ref|State)$/

interface IState {
  opts?: {
    onlyBuiltIns?: boolean
    lib?: boolean
  }
}

export default function ({
  types: t,
}: {
  types: typeof BabelTypes
}): PluginObject {
  const visitor: Visitor<IState> = {
    CallExpression(path, state: IState): void {
      const onlyBuiltIns = state.opts?.onlyBuiltIns || false

      // options.lib が指定されている場合、それはフック関数を提供するライブラリの一覧である
      const libs =
        state.opts?.lib === true ? [`react`, `preact/hooks`] : [state.opts!.lib]

      // 変数宣言の初期化子ではない関数呼び出しは飛ばす:
      if (!t.isVariableDeclarator(path.parent)) return

      // 戻り値が配列の分割代入で受け取られていない関数呼び出しは飛ばす:
      if (!t.isArrayPattern(path.parent.id)) return

      // 呼び出されている（フック）関数の名前:
      const hookName = (path.node.callee as BabelTypes.Identifier).name

      if (libs) {
        const binding = path.scope.getBinding(hookName)
        // import ではない
        if (!binding || binding.kind !== `module`) return

        const specifier = (binding.path.parent as BabelTypes.ImportDeclaration)
          .source.value
        // 一致しない
        if (!libs.some(lib => lib === specifier)) return
      }

      // フックらしい名前の関数呼び出しだけを対象にする
      if (!(onlyBuiltIns ? isBuiltInHook : isHook).test(hookName)) return

      path.parent.id = t.objectPattern(
        path.parent.id.elements.reduce(
          (acc: Array<BabelTypes.ObjectProperty>, element, i) => {
            if (element) {
              acc.push(
                t.objectProperty(
                  t.numericLiteral(i),
                  element as BabelTypes.Identifier
                )
              )
            }
            return acc
          },
          []
        )
      )
    },
  }

  return {
    name: `optimize-hook-destructuring`,
    visitor: {
      // preset-env が分割代入を壊す前に実行するための回避策
      Program(path: NodePath<BabelTypes.Program>, state: any): void {
        path.traverse(visitor, state)
      },
    },
  }
}
