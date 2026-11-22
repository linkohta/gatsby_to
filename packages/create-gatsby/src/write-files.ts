import * as fs from "fs-extra"
import path from "path"

export interface IFile {
  source: string
  targetPath: string
}

async function writeFile({ source, targetPath }: IFile): Promise<void> {
  // スタブを読み込む
  const stubData = await fs.readFile(source)
  // スタブを targetPath へ書き出す
  await fs.outputFile(targetPath, stubData)
}

export async function writeFiles(
  rootPath: string,
  files: Array<IFile> | undefined
): Promise<void> {
  if (!files) {
    return
  }

  // stub/ ディレクトリからファイルを取得するために必要
  const createGatsbyRoot = path.join(__dirname, `..`)
  // ファイルを並列に作成する
  const results = []

  for (const file of files) {
    const source = path.resolve(createGatsbyRoot, file.source)
    const targetPath = path.resolve(rootPath, file.targetPath)

    results.push(writeFile({ source, targetPath }))
  }

  await Promise.all(results)
}
