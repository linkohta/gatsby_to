import fs from "fs"
import crypto from "crypto"
import { globSync } from "../../../utils/glob"

export function createFileContentHash(
  root: string,
  globPattern: string
): string {
  // TODO: hash-wasm を使う
  const hash = crypto.createHash(`md5`)
  const files = globSync(`${root}/${globPattern}`, { nodir: true })

  files.forEach(filepath => {
    hash.update(fs.readFileSync(filepath))
  })

  return hash.digest(`hex`)
}
