const NodeEnvironment = require(`jest-environment-node`).TestEnvironment
const fsExtra = require(`fs-extra`)

const isWindows = process.platform === `win32`

class CustomEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context)
  }

  async teardown(): Promise<void> {
    // close open lmdbs after running test suite
    // this prevent dangling open handles that sometimes cause problems
    // particularly in windows tests (failures to move or delete a db file)
    if (this.global.__GATSBY_OPEN_ROOT_LMDBS) {
      if (isWindows) {
        for (const rootDb of this.global.__GATSBY_OPEN_ROOT_LMDBS.values()) {
          await rootDb.clearAsync()
          await rootDb.close()
        }
      } else {
        for (const [
          dbPath,
          rootDb,
        ] of this.global.__GATSBY_OPEN_ROOT_LMDBS.entries()) {
          if (rootDb.isOperational()) {
            // lmdb 2.5.3 では、前のトランザクションを書き込んでいる間に次のイベントターンの書き込みが
            // 始まると、その書き込みの flush を待つ Promise が解決されないまま残ることがある。
            // close() はその Promise を待つので、ここで止まるとテストスイートの片付けが終わらなくなる
            // （ここにはテストのタイムアウトも効かない）。新しいトランザクションを 1 つ完了させると、
            // 残っていた Promise も解決される。そのため close() の前に空のトランザクションを実行する
            await rootDb.committed
            await rootDb.transaction(() => {})
            await rootDb.close()
          }
          await fsExtra.remove(dbPath)
        }
      }

      this.global.__GATSBY_OPEN_ROOT_LMDBS = undefined
    }
    await super.teardown()
  }
}

module.exports = CustomEnvironment
