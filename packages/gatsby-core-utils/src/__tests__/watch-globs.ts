import { createGlobWatchFilter } from "../watch-globs"

const file = { isDirectory: (): boolean => false }
const directory = { isDirectory: (): boolean => true }

describe(`createGlobWatchFilter`, () => {
  describe(`add`, () => {
    it(`replaces globs with their parent directory`, () => {
      const filter = createGlobWatchFilter()

      expect(
        filter.add([
          `/site/src/**/*.{js,jsx,ts,tsx}`,
          `/site/.env*`,
          `/site/plugins/**/gatsby-ssr.js`,
        ])
      ).toEqual([`/site/src`, `/site`, `/site/plugins`])
    })

    it(`keeps paths that are not globs`, () => {
      const filter = createGlobWatchFilter()

      expect(filter.add(`/site/src/html.js`)).toEqual([`/site/src/html.js`])
      expect(filter.add([`/site/static`])).toEqual([`/site/static`])
    })

    it(`resolves relative globs against cwd`, () => {
      const filter = createGlobWatchFilter({ cwd: `/site/src/pages` })

      expect(filter.add(`**/*.{js,tsx}`)).toEqual([`/site/src/pages`])
    })

    it(`does not watch negated paths`, () => {
      const filter = createGlobWatchFilter()

      expect(filter.add([`/site/src/**/*.js`, `!/site/src/skip/**`])).toEqual([
        `/site/src`,
      ])
      expect(filter.ignored(`/site/src/skip/a.js`, file)).toBe(true)
      expect(filter.ignored(`/site/src/keep/a.js`, file)).toBe(false)
    })
  })

  describe(`ignored`, () => {
    it(`ignores nothing when no paths and no ignore rules are given`, () => {
      const filter = createGlobWatchFilter()

      expect(filter.ignored(`/site/any/file.css`, file)).toBe(false)
      expect(filter.ignored(`/site/any`, directory)).toBe(false)
    })

    it(`only keeps files that match a glob`, () => {
      const filter = createGlobWatchFilter()
      filter.add(`/site/src/**/*.{js,jsx,ts,tsx}`)

      expect(filter.ignored(`/site/src/pages/index.js`, file)).toBe(false)
      expect(filter.ignored(`/site/src/pages/deep/a.tsx`, file)).toBe(false)
      expect(filter.ignored(`/site/src/pages/style.css`, file)).toBe(true)
      expect(filter.ignored(`/site/src/.hidden.js`, file)).toBe(false)
    })

    it(`keeps directories a globstar can reach`, () => {
      const filter = createGlobWatchFilter()
      filter.add(`/site/src/**/*.js`)

      expect(filter.ignored(`/site/src`, directory)).toBe(false)
      expect(filter.ignored(`/site/src/pages/deep`, directory)).toBe(false)
    })

    it(`does not descend into directories the glob cannot match`, () => {
      const filter = createGlobWatchFilter()
      filter.add(`/site/.env*`)

      expect(filter.ignored(`/site`, directory)).toBe(false)
      expect(filter.ignored(`/site/.env.development`, file)).toBe(false)
      expect(filter.ignored(`/site/node_modules`, directory)).toBe(true)
      expect(filter.ignored(`/site/src`, directory)).toBe(true)
      expect(filter.ignored(`/site/gatsby-config.js`, file)).toBe(true)
    })

    it(`treats extglob directory patterns the way chokidar 3 did`, () => {
      const files = `*.+(t|j)s?(x)`
      const filter = createGlobWatchFilter()
      filter.add(
        `/site/node_modules/theme/{${files},!(node_modules)/**/${files}}`
      )

      expect(filter.ignored(`/site/node_modules/theme/index.js`, file)).toBe(
        false
      )
      expect(filter.ignored(`/site/node_modules/theme/readme.md`, file)).toBe(
        true
      )
      expect(
        filter.ignored(`/site/node_modules/theme/node_modules`, directory)
      ).toBe(true)
      // chokidar 3 は、フォルダー名を `!(node_modules)` と照合するときに先頭の `!` を
      // 否定として扱うため、どのフォルダーにも入らなかった。その動作をそのまま保っている。
      expect(filter.ignored(`/site/node_modules/theme/src`, directory)).toBe(
        true
      )
    })

    it(`keeps everything below a path that is not a glob`, () => {
      const filter = createGlobWatchFilter()
      filter.add([`/site/src/**/*.js`, `/site/src/pages/style.css`])
      filter.add(`/site/content`)

      expect(filter.ignored(`/site/src/pages/style.css`, file)).toBe(false)
      expect(filter.ignored(`/site/src/pages/other.css`, file)).toBe(true)
      expect(filter.ignored(`/site/content/a/b.md`, file)).toBe(false)
      expect(filter.ignored(`/site/content/a`, directory)).toBe(false)
    })

    it(`keeps paths added later`, () => {
      const filter = createGlobWatchFilter()
      filter.add(`/site/src/**/*.js`)

      expect(filter.ignored(`/site/src/pages/post.mdx`, file)).toBe(true)

      filter.add(`/site/src/pages/post.mdx`)

      expect(filter.ignored(`/site/src/pages/post.mdx`, file)).toBe(false)
    })

    it(`applies ignore globs, regular expressions and functions`, () => {
      const filter = createGlobWatchFilter({
        ignored: [
          `**/.DS_Store`,
          `**/node_modules`,
          /~$/,
          (path: string): boolean => path.endsWith(`.tmp`),
        ],
      })
      filter.add(`/site/content`)

      expect(filter.ignored(`/site/content/a.md`, file)).toBe(false)
      expect(filter.ignored(`/site/content/sub/.DS_Store`, file)).toBe(true)
      expect(filter.ignored(`/site/content/node_modules`, directory)).toBe(true)
      expect(filter.ignored(`/site/content/a.md~`, file)).toBe(true)
      expect(filter.ignored(`/site/content/a.tmp`, file)).toBe(true)
    })

    it(`ignores everything below an ignored path that is not a glob`, () => {
      const filter = createGlobWatchFilter({ ignored: [`/site/content/skip`] })
      filter.add(`/site/content`)

      expect(filter.ignored(`/site/content/skip`, directory)).toBe(true)
      expect(filter.ignored(`/site/content/skip/a/b.md`, file)).toBe(true)
      expect(filter.ignored(`/site/content/keep/a.md`, file)).toBe(false)
    })

    it(`resolves relative paths against cwd`, () => {
      const filter = createGlobWatchFilter({ cwd: `/site/src/pages` })
      filter.add(`**/*.js`)

      expect(filter.ignored(`blog/index.js`, file)).toBe(false)
      expect(filter.ignored(`blog/index.css`, file)).toBe(true)
      expect(filter.ignored(`/site/src/pages/blog/index.js`, file)).toBe(false)
    })

    it(`decides without stats when the path is already gone`, () => {
      const filter = createGlobWatchFilter({ ignored: [`**/*.d.ts`] })
      filter.add(`/site/src/api/*.js`)

      expect(filter.ignored(`/site/src/api/hello.js`)).toBe(false)
      expect(filter.ignored(`/site/src/api/types.d.ts`)).toBe(true)
      expect(filter.ignored(`/site/src/api/nested/hello.css`)).toBe(true)
    })
  })
})
