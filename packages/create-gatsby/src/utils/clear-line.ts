const ESC = `\u001b`

export const clearLine = (count = 1): Promise<void> =>
  new Promise(resolve => {
    // まずカーソルを 1 行上へ移動し...
    process.stderr.moveCursor(0, -count, () => {
      // ... 次にその行を消去する。これは「行全体を消去する」ANSI エスケープシーケンスである
      // エスケープシーケンスの一覧: http://ascii-table.com/ansi-escape-sequences.php
      process.stderr.write(`${ESC}[2K`)
      resolve()
    })
  })
