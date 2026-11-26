import path from "path"
import { remove, mkdirp } from "fs-extra"
import { createMutex } from "../mutex"
import * as storage from "../utils/get-storage"

jest.spyOn(storage, `getDatabaseDir`)

function sleep(timeout = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeout))
}

async function doAsync(
  mutex: ReturnType<typeof createMutex>,
  result: Array<string> = [],
  waitFor: number | Promise<void>,
  id: string
): Promise<Array<string>> {
  await mutex.acquire()
  result.push(`start ${id}`)
  await (typeof waitFor === `number` ? sleep(waitFor) : waitFor)
  result.push(`stop ${id}`)
  await mutex.release()

  return result
}

describe(`mutex`, () => {
  const cachePath = path.join(__dirname, `.cache`)
  beforeAll(async () => {
    await mkdirp(cachePath)
    storage.getDatabaseDir.mockReturnValue(cachePath)
  })

  afterAll(async () => {
    await storage.closeDatabase()
    globalThis.__GATSBY_OPEN_LMDBS.delete(storage.getDatabaseDir())
    await remove(cachePath)
  })

  it(`should only allow one action go through at the same time`, async () => {
    const mutex = createMutex(`test-key`, 300)

    const result: Array<string> = []

    doAsync(mutex, result, 50, `1`)
    await sleep(0)
    await doAsync(mutex, result, 10, `2`)

    expect(result).toMatchInlineSnapshot(`
      Array [
        "start 1",
        "stop 1",
        "start 2",
        "stop 2",
      ]
    `)
  })

  it(`should generate the same mutex if key are identical`, async () => {
    const mutex1 = createMutex(`test-key`, 300)
    const mutex2 = createMutex(`test-key`, 300)

    const result: Array<string> = []

    const mutexPromise = doAsync(mutex1, result, 50, `1`)
    await sleep(0)
    await doAsync(mutex2, result, 10, `2`)
    await mutexPromise

    expect(result).toMatchInlineSnapshot(`
      Array [
        "start 1",
        "stop 1",
        "start 2",
        "stop 2",
      ]
    `)
  })

  it(`shouldn't wait if keys are different`, async () => {
    const mutex1 = createMutex(`test-key`, 300)
    const mutex2 = createMutex(`other-key`, 300)

    const result: Array<string> = []

    // 1 の処理は、2 の処理が終わるまでミューテックスを保持し続ける。待ち時間で順序を
    // 作ると、負荷が高いときに 2 がミューテックスを取る前に 1 が終わってしまうことがある
    let finishFirst: () => void = () => {}
    const secondIsDone = new Promise<void>(resolve => {
      finishFirst = resolve
    })

    const mutexPromise = doAsync(mutex1, result, secondIsDone, `1`)
    await sleep(0)
    await doAsync(mutex2, result, 10, `2`)
    finishFirst()
    await mutexPromise

    expect(result).toMatchInlineSnapshot(`
      Array [
        "start 1",
        "start 2",
        "stop 2",
        "stop 1",
      ]
    `)
  })
})
