const path = require(`path`)
const child = require(`child_process`)

it(`Builds cache-dir with minimal config`, done => {
  const args = [
    require.resolve(`@babel/cli/bin/babel.js`),
    path.join(__dirname, `..`),
    `--config-file`,
    path.join(__dirname, `.babelrc`),
    `--ignore`,
    `**/__tests__`,
  ]

  const spawn = child.spawn(process.execPath, args)

  let stderr = ``
  let stdout = ``

  spawn.stderr.on(`data`, function (chunk) {
    stderr += chunk
  })

  spawn.stdout.on(`data`, function (chunk) {
    stdout += chunk
  })

  spawn.on(`close`, function () {
    try {
      // 少し奇妙だが、この Node.js の非推奨警告は Node 22 以降で出力される。一方で、CI では
      // なぜか Node.js の警告をすべて抑制している。このパターンは、stderr に何も出力されない場合と
      // この警告だけが出力される場合の両方を許容し、ローカルでも CI でもテストが通るようにする。
      expect(stderr).toMatch(
        /^(|\(node:\d+\) \[DEP0180\] DeprecationWarning: fs\.Stats constructor is deprecated\.\s+\(Use `node --trace-deprecation \.\.\.` to show where the warning was created\)[\s\n]*)$/s
      )
      expect(stdout).not.toEqual(``)
    } catch (err) {
      done(err)
      return
    }
    done()
  })
}, 30000)
