export const testImportError = (moduleName: string, err: any): boolean => {
  // import が依存ツリーのルールでは許可されているが、要求されたファイルが
  // 存在しない場合、PnP は次のコードを返す
  if (
    err.code === `QUALIFIED_PATH_RESOLUTION_FAILED` ||
    err.pnpCode === `QUALIFIED_PATH_RESOLUTION_FAILED`
  ) {
    return true
  }
  const regex = new RegExp(
    // stderr には ModuleNotFoundError と表示されるが、下で toString するので Error で正しい
    `Error:\\s(\\S+\\s)?[Cc]annot find module\\s.${moduleName.replace(
      /[-/\\^$*+?.()|[\]{}]/g,
      `\\$&`
    )}`
  )

  const [firstLine] = err.toString().split(`\n`)
  return regex.test(firstLine.replace(/\\\\/g, `\\`))
}
