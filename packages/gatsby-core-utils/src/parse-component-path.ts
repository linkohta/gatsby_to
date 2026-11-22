// gatsby-plugin-mdx v4 以降は、webpack のローダーの resourceQuery 機能を使って、
// コンテンツファイルをページコンポーネントに注入している。
// 以下のヘルパー関数は、この新しいページコンポーネントのパスの URI を
// 扱いやすくするためのものである。

const CONTENT_FILE_PATH_QUERY = `?__contentFilePath=`

// コストの高い URI.parse() を使わずに、パスコンポーネントの URI を分割する
export const splitComponentPath = (componentPath: string): Array<string> => {
  // パスに contentFilePath クエリが含まれていなければ、通常のパスとみなせる
  if (!componentPath.includes(CONTENT_FILE_PATH_QUERY)) {
    return [componentPath]
  }

  const cleanedComponentPath = componentPath.replace(
    /&export=(default|head)$/,
    ``
  )
  const splitPath = cleanedComponentPath.split(CONTENT_FILE_PATH_QUERY)

  // `?__contentFilePath=` パラメーター付きの URI パスにだけ対応している
  if (splitPath.length !== 2) {
    throw new Error(
      `The following page component must contain '${CONTENT_FILE_PATH_QUERY}':\n${cleanedComponentPath}`
    )
  }

  return splitPath
}

// 実際の js のページコンポーネントのパスを取得する
export const getPathToLayoutComponent = (componentPath: string): string =>
  splitComponentPath(componentPath)[0]

// コンテンツファイルのパスを取得する。コンテンツファイルが指定されていなければ js コンポーネントを使う。
// `.mdx` ファイルから直接作られたページ
export const getPathToContentComponent = (componentPath: string): string => {
  const splitPath = splitComponentPath(componentPath)
  if (splitPath.length === 1) {
    return splitPath[0]
  }
  return splitPath[1]
}
