const {
  setActions,
  // queue: jobQueue,
  // reportError,
  _unstable_createJob,
  _lazyJobsEnabled,
} = require(`./index`)
const { pathExists } = require(`fs-extra`)
const { slash } = require(`gatsby-core-utils/path`)

const { setPluginOptions } = require(`./plugin-options`)
const path = require(`path`)

function removeCachedValue(cache, key) {
  if (cache?.del) {
    // キャッシュが公開インターフェースで ".del" メソッドを直接提供している場合
    return cache.del(key)
  } else if (cache?.cache?.del) {
    // レガシー: 内部のキャッシュインスタンスを使い、その ".del" を直接呼び出す
    return cache.cache.del(key)
  }
  return Promise.reject(
    new Error(`Cache instance doesn't expose ".del" function`)
  )
}

exports.onCreateDevServer = async ({ app, cache, reporter }) => {
  if (!_lazyJobsEnabled()) {
    return
  }

  app.use(async (req, res, next) => {
    const decodedURI = decodeURIComponent(req.path)
    const pathOnDisk = path.resolve(path.join(`./public/`, decodedURI))

    const jobContentDigest = await cache.get(decodedURI)
    const cacheResult = jobContentDigest
      ? await cache.get(jobContentDigest)
      : null

    if (!cacheResult) {
      // このハンドラーは、遅延画像（処理対象として登録されたが、develop サーバーで
      // リクエストがあるまで処理を先送りした画像）だけを扱うためのものである。
      // キャッシュに結果がない場合は、遅延画像ではないか、すでに処理済みの画像である。
      // その場合は、（このハンドラーより前にある）`express.static` のハンドラーが
      // リクエストを処理する。
      return next()
    }

    // 1 つの操作だけのジョブを実行し、
    // 残りの操作はすべて後回しにする
    // これにより、ブラウザでの遅延画像の読み込みが速くなり、
    // ブラウザの接続キューも早く空く。
    const { matchingJob, jobWithRemainingOperations } =
      splitOperationsByRequestedFile(cacheResult, pathOnDisk)

    await _unstable_createJob(matchingJob, { reporter })
    await removeCachedValue(cache, decodedURI)

    if (jobWithRemainingOperations.args.operations.length > 0) {
      // このジョブにはまだ保留中の操作が残っている。キャッシュ済みのジョブを置き換える
      await cache.set(jobContentDigest, jobWithRemainingOperations)
    } else {
      // 処理する操作が残っていない。キャッシュを消去する
      await removeCachedValue(cache, jobContentDigest)
    }

    // ここに到達するのは、たった今処理した遅延画像の場合だけである
    // `express.static` のほうが前のハンドラーなので、現在のリクエストに対しては
    // 生成したファイルを手動で配信する必要がある
    return res.sendFile(pathOnDisk)
  })
}

// ジョブを 2 つに分割する:
//  - 1 つ目は、requestedPathOnDisk に一致する操作 1 つだけを持つジョブ
//  - 2 つ目は、それ以外のすべての操作を持つジョブ
// そのため、できあがる 2 つのジョブは操作だけが異なる
function splitOperationsByRequestedFile(job, requestedPathOnDisk) {
  const matchingJob = {
    ...job,
    args: { ...job.args, operations: [] },
  }
  const jobWithRemainingOperations = {
    ...job,
    args: { ...job.args, operations: [] },
  }

  job.args.operations.forEach(op => {
    const operationPath = path.resolve(path.join(job.outputDir, op.outputPath))
    if (operationPath === requestedPathOnDisk) {
      matchingJob.args.operations.push(op)
    } else {
      jobWithRemainingOperations.args.operations.push(op)
    }
  })
  if (matchingJob.args.operations.length === 0) {
    throw new Error(
      `Could not find matching operation for ${requestedPathOnDisk}`
    )
  }
  return { matchingJob, jobWithRemainingOperations }
}

// reporter に何か問題があるようで、これを preBootstrap で行うと、
// プログレスバーが更新されない
exports.onPostBootstrap = async ({ reporter, cache, store }) => {
  if (process.env.gatsby_executing_command !== `develop`) {
    // develop がまだ起動していないジョブを作り直す
    // 古いジョブの削除はすでに始まっているので、これらはまだ処理が必要だと分かる
    for (const [contentDigest] of store.getState().jobsV2.complete) {
      const job = await cache.get(contentDigest)

      if (job) {
        // await する必要はない。gatsby が代わりに行う
        _unstable_createJob(job, { reporter })
      }
    }
  }
}

// ワーカーでプラグインを正しく初期化するためである（`onPreBootstrap` はワーカーでは実行されない）
exports.onPluginInit = async ({ actions }, pluginOptions) => {
  setActions(actions)
  setPluginOptions(pluginOptions)
}

exports.onPreBootstrap = async ({ actions, emitter, cache }, pluginOptions) => {
  setActions(actions)
  setPluginOptions(pluginOptions)

  // 以下は、重複したジョブを認識しないプログレスバーの紛らわしい挙動に対する
  // ハック、応急処置である。現在は gatsby コアの内部に
  // あるため（`createJobV2` が利用できる場合）、
  // これは削除するか、このコードパスに到達しないようにすべきである
  // （プラグインで emitter を使うべきではない）。
  // できるだけ早く対応したい（プログレスバーの処理を
  // コアの jobs-manager の中へ移すことになるだろう）

  if (emitter) {
    // 各ジョブが持つ画像変換の数を記録する
    // END_JOB_V2 にはその情報が含まれないので、
    // ジョブの作成時に <JobContentHash, TransformsCount> の map へ
    // 保存しておく。ジョブが終了したらそれを取り出し、
    // map からそのエントリーを削除する。
    const imageCountInJobsMap = new Map()

    emitter.on(`CREATE_JOB_V2`, action => {
      if (action.plugin.name === `gatsby-plugin-sharp`) {
        if (action.payload.job.args.isLazy) {
          // 内部用の要素をいくつか取り除く必要がある
          const job = {
            name: action.payload.job.name,
            inputPaths: action.payload.job.inputPaths.map(input => input.path),
            outputDir: action.payload.job.outputDir,
            args: {
              ...action.payload.job.args,
              isLazy: false,
            },
          }
          cache.set(action.payload.job.contentDigest, job)

          action.payload.job.args.operations.forEach(op => {
            const cacheKey = slash(
              path.relative(
                path.join(process.cwd(), `public`),
                path.join(action.payload.job.outputDir, op.outputPath)
              )
            )

            cache.set(`/${cacheKey}`, action.payload.job.contentDigest)
          })

          return
        }

        const job = action.payload.job
        const imageCount = job.args.operations.length
        imageCountInJobsMap.set(job.contentDigest, imageCount)
      }
    })

    emitter.on(`END_JOB_V2`, action => {
      if (action.plugin.name === `gatsby-plugin-sharp`) {
        const jobContentDigest = action.payload.jobContentDigest

        // 遅延の場合は設定していない
        if (!imageCountInJobsMap.has(jobContentDigest)) {
          return
        }

        imageCountInJobsMap.delete(jobContentDigest)
      }
    })
  }

  // normalizedOptions = setPluginOptions(pluginOptions)
}

exports.pluginOptionsSchema = ({ Joi }) =>
  Joi.object({
    base64Width: Joi.number()
      .default(20)
      .description(`The width of the generated base64 preview image`),
    forceBase64Format: Joi.any()
      .valid(`png`, `jpg`, `webp`)
      .description(
        `Force a different format for the generated base64 image. Defaults to the same format as the input image`
      ),
    useMozJpeg: Joi.boolean().description(
      `The the mozJpeg library for encoding. Defaults to false, unless \`process.env.GATSBY_JPEG_ENCODER\` === \`MOZJPEG\``
    ),
    stripMetadata: Joi.boolean().default(true),
    defaultQuality: Joi.number().default(50),
    // TODO(v6): 非推奨の failOnError オプションを削除する
    failOnError: Joi.boolean().default(true),
    failOn: Joi.any()
      .valid(`none`, `truncated`, `error`, `warning`)
      .default(`warning`)
      .description(`Level of sensitivity to invalid images`),
    defaults: Joi.object({
      formats: Joi.array().items(
        Joi.string().valid(`auto`, `png`, `jpg`, `webp`, `avif`)
      ),
      placeholder: Joi.string().valid(
        `tracedSVG`,
        `dominantColor`,
        `blurred`,
        `none`
      ),
      quality: Joi.number(),
      breakpoints: Joi.array().items(Joi.number()),
      backgroundColor: Joi.string(),
      transformOptions: Joi.object(),
      tracedSVGOptions: Joi.object(),
      blurredOptions: Joi.object(),
      jpgOptions: Joi.object(),
      pngOptions: Joi.object(),
      webpOptions: Joi.object(),
      avifOptions: Joi.object(),
    }).description(
      `Default options used by gatsby-plugin-image. \nSee https://gatsbyjs.com/docs/reference/built-in-components/gatsby-plugin-image/`
    ),
  }).custom(value => {
    const shouldNotFailOnError = !value.failOnError

    if (shouldNotFailOnError) {
      // この警告は、メインプロセスで 1 回だけ表示する
      if (!process.env.GATSBY_WORKER_ID) {
        console.warn(
          `[gatsby-plugin-sharp]: The "failOnError" option is deprecated. Please use "failOn" instead.`
        )
      }

      return {
        ...value,
        failOn: `none`,
      }
    }

    return {
      ...value,
    }
  })
