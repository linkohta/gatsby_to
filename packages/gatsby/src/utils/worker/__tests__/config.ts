import { createTestWorker, GatsbyTestWorkerPool } from "./test-helpers"
import { store } from "../../../redux"
import * as path from "path"
import { compileGatsbyFiles } from "../../parcel/compile-gatsby-files"

let worker: GatsbyTestWorkerPool | undefined

beforeEach(() => {
  store.dispatch({ type: `DELETE_CACHE` })
})

afterEach(async () => {
  if (worker) {
    await Promise.all(worker.end())
    worker = undefined
  }
})

it(`can load config and execute node API in worker`, async () => {
  worker = createTestWorker()

  const siteDirectory = path.join(__dirname, `fixtures`, `sample-site`)
  await compileGatsbyFiles(siteDirectory)

  // カスタムのローカルプラグインのプラグインオプションには関数が含まれる (() => `foo`)
  await Promise.all(
    worker.all.loadConfigAndPlugins({
      siteDirectory,
    })
  )

  // プラグイン API がプラグインオプションの関数を実行し、結果を `global` に保存する
  await Promise.all(worker.all.runAPI(`createSchemaCustomization`))

  // `global` に保存された結果を取得する
  expect(await worker.single.getAPIRunResult()).toEqual(`foo`)
})
