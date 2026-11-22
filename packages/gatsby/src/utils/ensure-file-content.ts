import { outputFile, readFile } from "fs-extra"

export async function ensureFileContent(
  file: string,
  data: any
): Promise<boolean> {
  let previousContent: string | undefined = undefined
  try {
    previousContent = await readFile(file, `utf8`)
  } catch (e) {
    // 何が投げられても、とにかくファイルを書き込む
  }

  if (previousContent !== data) {
    await outputFile(file, data)
    return true
  }

  return false
}
