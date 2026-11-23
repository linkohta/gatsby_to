const path = require(`path`)
const fs = require(`fs-extra`)
const mime = require(`mime`)
// pretty-bytes 6 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: prettyBytes } = require(`pretty-bytes`)

const { createContentDigest, slash, md5File } = require(`gatsby-core-utils`)

exports.createFileNode = async (
  pathToFile,
  createNodeId,
  pluginOptions = {},
  cache = null
) => {
  const slashed = slash(pathToFile)
  const parsedSlashed = path.parse(slashed)
  const slashedFile = {
    ...parsedSlashed,
    absolutePath: slashed,
    // 特定の親ディレクトリで graphql クエリを絞り込むのに役立つ
    relativeDirectory: slash(
      path.relative(pluginOptions.path || process.cwd(), parsedSlashed.dir)
    ),
  }

  const stats = await fs.stat(slashedFile.absolutePath)
  let internal
  if (stats.isDirectory()) {
    const contentDigest = createContentDigest({
      stats: stats,
      absolutePath: slashedFile.absolutePath,
    })
    internal = {
      contentDigest,
      type: `Directory`,
      description: `Directory "${path.relative(process.cwd(), slashed)}"`,
    }
  } else {
    const key = stats.mtimeMs.toString() + stats.ino.toString()
    let contentDigest

    if (pluginOptions.fastHash) {
      // ハッシュ化をスキップする。
      contentDigest = key
    } else {
      // ファイルが変更された場合にだけ、ハッシュを生成する。
      contentDigest = cache && (await cache.get(key))
      if (!contentDigest) {
        contentDigest = await md5File(slashedFile.absolutePath)
        if (cache) await cache.set(key, contentDigest)
      }
    }

    const mediaType = mime.getType(slashedFile.ext)
    internal = {
      contentDigest,
      type: `File`,
      mediaType: mediaType ? mediaType : `application/octet-stream`,
      description: `File "${path.relative(process.cwd(), slashed)}"`,
    }
  }

  return {
    // File の id を絶対パスそのものにはしない。そうすると
    // id がパスとして使われてしまうが、id は意味のある情報として
    // 扱われるべきではない。
    id: createNodeId(pathToFile),
    children: [],
    parent: null,
    internal,
    sourceInstanceName: pluginOptions.name || `__PROGRAMMATIC__`,
    relativePath: slash(
      path.relative(
        pluginOptions.path || process.cwd(),
        slashedFile.absolutePath
      )
    ),
    extension: slashedFile.ext.slice(1).toLowerCase(),
    prettySize: prettyBytes(stats.size),
    modifiedTime: stats.mtime.toJSON(),
    accessTime: stats.atime.toJSON(),
    changeTime: stats.ctime.toJSON(),
    birthTime: stats.birthtime.toJSON(),
    // Note: slashedFile オブジェクトの展開は非推奨にする
    // Note: オブジェクトが持つプロパティは File か Dir かによって異なることがある
    ...slashedFile,
    // TODO: オブジェクト全体のコピーを非推奨にする
    // Note: パフォーマンス上の理由で展開していない（Date オブジェクトが確実にシリアライズされるようにする）
    dev: stats.dev,
    mode: stats.mode,
    nlink: stats.nlink,
    uid: stats.uid,
    rdev: stats.rdev,
    blksize: stats.blksize,
    ino: stats.ino,
    size: stats.size,
    blocks: stats.blocks,
    atimeMs: stats.atimeMs,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    birthtimeMs: stats.birthtimeMs,
    atime: stats.atime.toJSON(),
    mtime: stats.mtime.toJSON(),
    ctime: stats.ctime.toJSON(),
    birthtime: stats.birthtime.toJSON(),
  }
}
