import { ignorePath } from "../ignore-path"

describe(`ignore-path`, () => {
  it(`does not filter files without an ignore object`, () => {
    const ignoreFiles = [
      { path: `blog.js` },
      { path: `post.tsx` },
      { path: `file.example.jsx` },
      { path: `file.example.tsx` },
      { path: `dir/file.example.js` },
    ]

    const testFiles = ignoreFiles.concat([
      // blog または post はサブディレクトリに、ほかのページはトップディレクトリにある
      { path: `dir/blog.jsx` },
      { path: `dir/post.ts` },
      { path: `other.js` },
      // 拡張子の前に .example が付いていない example ページまたはディレクトリ
      { path: `example.js` },
      { path: `example/file.tsx` },
      { path: `dir/example.jsx` },
    ])

    expect(testFiles.filter(file => ignorePath(file.path, null))).toEqual([])
  })

  it(`does not filter files without any ignore patterns`, () => {
    const ignoreFiles = [
      { path: `blog.js` },
      { path: `post.tsx` },
      { path: `file.example.jsx` },
      { path: `file.example.tsx` },
      { path: `dir/file.example.js` },
    ]

    const testFiles = ignoreFiles.concat([
      // blog または post はサブディレクトリに、ほかのページはトップディレクトリにある
      { path: `dir/blog.jsx` },
      { path: `dir/post.ts` },
      { path: `other.js` },
      // 拡張子の前に .example が付いていない example ページまたはディレクトリ
      { path: `example.js` },
      { path: `example/file.tsx` },
      { path: `dir/example.jsx` },
    ])

    expect(testFiles.filter(file => ignorePath(file.path, {}))).toEqual([])
  })

  it(`filters out files matching ignore patterns`, () => {
    const patterns = [
      // pages ディレクトリの直下にある 'blog' または 'post' という名前のファイル
      `(blog|post).(js|ts|jsx|tsx)*`,
      // js(x)/ts(x) の拡張子の前に .example が付いているすべてのファイル
      `**/*.example.(js|ts|jsx|tsx)`,
    ]

    const ignoreFiles = [
      { path: `blog.js` },
      { path: `post.tsx` },
      { path: `file.example.jsx` },
      { path: `file.example.tsx` },
      { path: `dir/file.example.js` },
    ]

    const testFiles = ignoreFiles.concat([
      // blog または post はサブディレクトリに、ほかのページはトップディレクトリにある
      { path: `dir/blog.jsx` },
      { path: `dir/post.ts` },
      { path: `other.js` },
      // 拡張子の前に .example が付いていない example ページまたはディレクトリ
      { path: `example.js` },
      { path: `example/file.tsx` },
      { path: `dir/example.jsx` },
    ])

    expect(
      testFiles.filter(file => ignorePath(file.path, { patterns }))
    ).toEqual(ignoreFiles)
  })

  it(`filters out files matching ignore patterns w/ options.nocase`, () => {
    const patterns = [
      // pages ディレクトリの直下にある 'blog' または 'post' という名前のファイル
      `(blog|post).(js|ts|jsx|tsx)*`,
      // js(x)/ts(x) の拡張子の前に .example が付いているすべてのファイル
      `**/*.example.(js|ts|jsx|tsx)`,
    ]

    // https://www.npmjs.com/package/micromatch#optionsnocase
    const options = { nocase: true }

    const ignoreFiles = [
      { path: `blog.js` },
      { path: `POST.tsx` },
      { path: `file.example.jsx` },
      { path: `file.EXAMPLE.tsx` },
      { path: `dir/file.example.js` },
      { path: `dir/file.EXAMPLE.js` },
    ]

    const testFiles = ignoreFiles.concat([
      // blog または post はサブディレクトリに、ほかのページはトップディレクトリにある
      { path: `dir/blog.jsx` },
      { path: `dir/post.ts` },
      { path: `other.js` },
      // 拡張子の前に .example が付いていない example ページまたはディレクトリ
      { path: `example.js` },
      { path: `example/file.tsx` },
      { path: `dir/example.jsx` },
    ])

    expect(
      testFiles.filter(file => ignorePath(file.path, { patterns, options }))
    ).toEqual(ignoreFiles)
  })

  it(`filters out files matching ignore patterns as shorthand array`, () => {
    const patterns = [
      // pages ディレクトリの直下にある 'blog' または 'post' という名前のファイル
      `(blog|post).(js|ts|jsx|tsx)*`,
      // js(x)/ts(x) の拡張子の前に .example が付いているすべてのファイル
      `**/*.example.(js|ts|jsx|tsx)`,
    ]

    const ignoreFiles = [
      { path: `blog.js` },
      { path: `post.tsx` },
      { path: `file.example.jsx` },
      { path: `file.example.tsx` },
      { path: `dir/file.example.js` },
    ]

    const testFiles = ignoreFiles.concat([
      // blog または post はサブディレクトリに、ほかのページはトップディレクトリにある
      { path: `dir/blog.jsx` },
      { path: `dir/post.ts` },
      { path: `other.js` },
      // 拡張子の前に .example が付いていない example ページまたはディレクトリ
      { path: `example.js` },
      { path: `example/file.tsx` },
      { path: `dir/example.jsx` },
    ])

    expect(testFiles.filter(file => ignorePath(file.path, patterns))).toEqual(
      ignoreFiles
    )
  })

  it(`filters out files matching ignore pattern as shorthand string`, () => {
    const pattern = `(blog|post).(js|ts|jsx|tsx)*`
    // pages ディレクトリの直下にある 'blog' または 'post' という名前のファイル

    const ignoreFiles = [{ path: `blog.js` }, { path: `post.tsx` }]

    const testFiles = ignoreFiles.concat([
      // blog または post はサブディレクトリに、ほかのページはトップディレクトリにある
      { path: `dir/blog.jsx` },
      { path: `dir/post.ts` },
      { path: `other.js` },
    ])

    expect(testFiles.filter(file => ignorePath(file.path, pattern))).toEqual(
      ignoreFiles
    )
  })
})
