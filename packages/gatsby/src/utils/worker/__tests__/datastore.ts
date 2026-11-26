import { createTestWorker, GatsbyTestWorkerPool } from "./test-helpers"
import { store } from "../../../redux"
import { actions } from "../../../redux/actions"
import { getDataStore } from "../../../datastore"

jest.mock(`gatsby-cli/lib/reporter`, () => {
  return {}
})

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

it(`worker can access node created in main process`, async () => {
  worker = createTestWorker()

  const testNodeId = `shared-node`

  expect(getDataStore().getNode(testNodeId)).toBeFalsy()
  expect(await worker.single.getNodeFromWorker(testNodeId)).toBeFalsy()

  const node = {
    id: testNodeId,
    parent: null,
    children: [],
    internal: { type: `SharedNode`, contentDigest: `0` },
    field: `should-be-accessible-in-worker`,
  }
  await store.dispatch(actions.createNode(node, { name: `test` }))
  await getDataStore().ready()

  const nodeStoredInMainProcess = getDataStore().getNode(testNodeId)
  // lmdb は、読み取りに使ったスナップショットを、タイマーで解放するまで使い続ける
  // （2.5.3 でも 3.5.11 でも同じ）。
  // ワーカーは上で読み取りを行ったばかりなので、ノードを作成する前のスナップショットが
  // まだ残っていることがある。その場合は null が返るので、新しいスナップショットに
  // 切り替わってノードが見えるようになるまで読み直す
  let nodeStoredInWorkerProcess =
    await worker.single.getNodeFromWorker(testNodeId)
  for (let retry = 0; retry < 100 && !nodeStoredInWorkerProcess; retry++) {
    await new Promise(resolve => setTimeout(resolve, 10))
    nodeStoredInWorkerProcess =
      await worker.single.getNodeFromWorker(testNodeId)
  }

  expect(nodeStoredInWorkerProcess).toMatchInlineSnapshot(`
    Object {
      "children": Array [],
      "field": "should-be-accessible-in-worker",
      "id": "shared-node",
      "internal": Object {
        "contentDigest": "0",
        "counter": 1,
        "owner": "test",
        "type": "SharedNode",
      },
      "parent": null,
    }
  `)
  expect(nodeStoredInWorkerProcess).toEqual(nodeStoredInMainProcess)
})
