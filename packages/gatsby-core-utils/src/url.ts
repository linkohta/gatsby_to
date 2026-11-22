import path from "path"
import os from "os"

/**
 * 渡されたすべてのセグメントを結合し、スラッシュ (/) を区切り文字として変換する
 * @param segments セグメントの並び
 */
export function urlResolve(...segments: Array<string>): string {
  const joinedPath = path.join(...segments)
  if (os.platform() === `win32`) {
    return joinedPath.replace(/\\/g, `/`)
  }

  return joinedPath
}
