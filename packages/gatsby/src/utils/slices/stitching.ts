import * as path from "path"
import * as fs from "fs-extra"
import { generateHtmlPath } from "gatsby-core-utils/page-html"

interface ISliceBoundaryMatch {
  index: number
  end: number
  syntax: "element" | "comment"
  id: string
  type: "start" | "end"
}

function ensureExpectedType(maybeType: string): "start" | "end" {
  if (maybeType === `start` || maybeType === `end`) {
    return maybeType
  } else {
    throw new Error(`Unexpected type: ${maybeType}. Expected "start" or "end"`)
  }
}

async function stitchSlices(
  htmlString: string,
  publicDir: string
): Promise<string> {
  let previousStart: ISliceBoundaryMatch | undefined = undefined

  let processedHTML = ``
  let cursor = 0

  async function getSliceContent(sliceHtmlName: string): Promise<string> {
    return fs.readFile(
      path.join(publicDir, `_gatsby`, `slices`, `${sliceHtmlName}.html`),
      `utf-8`
    )
  }

  for (const match of htmlString.matchAll(
    /(<slice-(?<startOrEndElementOpenening>start|end)\s[^>]*id="(?<idElement>[^"]+)"[^>]*><\/slice-(?<startOrEndElementClosing>[^>]+)>|<!-- slice-(?<startOrEndComment>start|end) id="(?<idComment>[^"]+)" -->)/g
  )) {
    if (!match.groups) {
      throw new Error(
        `Invariant: [stitching slices] Capturing groups should be defined`
      )
    }

    if (typeof match.index !== `number`) {
      throw new Error(
        `Invariant: [stitching slices] There is no location of a match when stitching slices`
      )
    }

    if (
      match.groups.startOrEndElementOpenening &&
      match.groups.startOrEndElementOpenening !==
        match.groups.startOrEndElementClosing
    ) {
      throw new Error(
        `Invariant: [stitching slices] start and end tags should be the same. Got: Start: ${match.groups.startOrEndElementOpenening} End: ${match.groups.startOrEndElementClosing}`
      )
    }

    const meta: ISliceBoundaryMatch = {
      index: match.index,
      end: match.index + match[0].length,
      ...(match.groups.startOrEndElementOpenening
        ? {
            syntax: `element`, // このフィールドは破棄できる
            id: match.groups.idElement,
            type: ensureExpectedType(match.groups.startOrEndElementOpenening),
          }
        : {
            syntax: `comment`, // このフィールドは破棄できる
            id: match.groups.idComment,
            type: ensureExpectedType(match.groups.startOrEndComment),
          }),
    }

    if (meta.type === `start`) {
      if (previousStart) {
        // すでにスライスの中にいる場合は、外側のスライスの終わりまでをすべて置き換えるので、
        // それらは無視するだけでよい
        continue
      }
      const newCursor = meta.end
      processedHTML +=
        htmlString.substring(cursor, meta.index) +
        `<!-- slice-start id="${meta.id}" -->`
      cursor = newCursor

      previousStart = meta
    } else if (meta.type === `end`) {
      if (!previousStart) {
        throw new Error(
          `Invariant: [stitching slices] There was no start tag, but close tag was found`
        )
      }
      if (previousStart.id !== meta.id) {
        // スライスはネストすることがある。処理したいのは最も外側のスライスだけである。
        // それをつなぎ合わせるときに、ネストしたスライスも再帰的に処理されるためである
        continue
      }

      processedHTML += `${await stitchSlices(
        await getSliceContent(meta.id),
        publicDir
      )}<!-- slice-end id="${meta.id}" -->`
      cursor = meta.end

      previousStart = undefined
    }
  }

  if (previousStart) {
    throw new Error(
      `Invariant: [stitching slices] There was start tag, but no close tag was found`
    )
  }

  // html の残りを取得する
  processedHTML += htmlString.substring(cursor)

  return processedHTML
}

export async function stitchSliceForAPage({
  pagePath,
  publicDir,
}: {
  pagePath: string
  publicDir: string
}): Promise<void> {
  const htmlFilePath = generateHtmlPath(publicDir, pagePath)

  const html = await fs.readFile(htmlFilePath, `utf-8`)

  const processedHTML = await stitchSlices(html, publicDir)

  if (html !== processedHTML) {
    await fs.writeFile(htmlFilePath, processedHTML)
  }
}
