import path from "path"
import { joinPath, createContentDigest } from "gatsby-core-utils"

export const withBasePath =
  (basePath: string) =>
  (...paths: Array<string>): string =>
    joinPath(basePath, ...paths)

export const withTrailingSlash = (basePath: string): string => `${basePath}/`

const posixJoinWithLeadingSlash = (paths: Array<string>): string =>
  path.posix.join(
    ...paths.map((segment, index) =>
      segment === `` && index === 0 ? `/` : segment
    )
  )

export const getCommonDir = (path1: string, path2: string): string => {
  const path1Segments = path1.split(/[/\\]/)
  const path2Segments = path2.split(/[/\\]/)

  for (let i = 0; i < path1Segments.length; i++) {
    if (i >= path2Segments.length) {
      return posixJoinWithLeadingSlash(path2Segments)
    } else if (
      path1Segments[i].toLowerCase() !== path2Segments[i].toLowerCase()
    ) {
      const joined = path1Segments.slice(0, i)
      return posixJoinWithLeadingSlash(joined)
    }
  }

  return posixJoinWithLeadingSlash(path1Segments)
}

// MacOS（APFS）と Windows（NTFS）のファイル名の長さの上限は 255 文字、その他は 255 バイト
const MAX_PATH_SEGMENT_CHARS = 255
const MAX_PATH_SEGMENT_BYTES = 255
const SLICING_INDEX = 50
const pathSegmentRe = /[^/]+/g

const isMacOs = process.platform === `darwin`
const isWindows = process.platform === `win32`

const isNameTooLong = (segment: string): boolean =>
  isMacOs || isWindows
    ? segment.length > MAX_PATH_SEGMENT_CHARS // MacOS（APFS）と Windows（NTFS）のファイル名の長さの上限（255 文字）
    : Buffer.from(segment).length > MAX_PATH_SEGMENT_BYTES // その他（255 バイト）

export const tooLongSegmentsInPath = (path: string): Array<string> => {
  const invalidFilenames: Array<string> = []
  for (const segment of path.split(`/`)) {
    if (isNameTooLong(segment)) {
      invalidFilenames.push(segment)
    }
  }
  return invalidFilenames
}

export const truncatePath = (path: string): string =>
  path.replace(pathSegmentRe, match => {
    if (isNameTooLong(match)) {
      return (
        match.slice(0, SLICING_INDEX) +
        createContentDigest(match.slice(SLICING_INDEX))
      )
    }
    return match
  })
