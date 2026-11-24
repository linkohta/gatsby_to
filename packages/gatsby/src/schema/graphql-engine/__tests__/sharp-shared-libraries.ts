import * as path from "path"
import * as os from "os"
import * as fs from "fs-extra"
import { getSharpSharedLibraries } from "../sharp-shared-libraries"

describe(`getSharpSharedLibraries`, () => {
  let root: string
  let outputDir: string

  const writePackage = (
    name: string,
    files: Array<string>,
    exportsField?: Record<string, string>
  ): string => {
    const packageDir = path.join(root, `node_modules`, `@img`, name)
    fs.outputJsonSync(path.join(packageDir, `package.json`), {
      name: `@img/${name}`,
      version: `1.0.0`,
      exports: exportsField,
    })
    for (const file of files) {
      fs.outputFileSync(path.join(packageDir, file), ``)
    }

    return packageDir
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), `sharp-shared-libraries-`))
    outputDir = path.join(root, `engine`)
  })

  afterEach(() => {
    fs.removeSync(root)
  })

  it(`returns nothing for binaries that do not belong to sharp`, () => {
    const lmdb = path.join(
      root,
      `node_modules`,
      `@lmdb`,
      `lmdb-linux-x64`,
      `node.napi.glibc.node`
    )
    fs.outputFileSync(lmdb, ``)

    expect(
      getSharpSharedLibraries(
        lmdb,
        path.join(outputDir, `assets`, `node.napi.glibc.node`),
        `linux-x64`
      )
    ).toEqual([])
  })

  it(`places libvips where the binary looks for it`, () => {
    const sharpDir = writePackage(`sharp-linux-x64`, [
      `lib/sharp-linux-x64-0.35.5.node`,
    ])
    const libvipsDir = writePackage(
      `sharp-libvips-linux-x64`,
      [
        `lib/index.js`,
        `lib/libvips-cpp.so.8.18.7`,
        `lib/glib-2.0/include/glibconfig.h`,
        `versions.json`,
      ],
      { "./lib": `./lib/index.js` }
    )

    expect(
      getSharpSharedLibraries(
        path.join(sharpDir, `lib`, `sharp-linux-x64-0.35.5.node`),
        path.join(outputDir, `assets`, `lib`, `sharp-linux-x64-0.35.5.node`),
        `linux-x64`
      )
    ).toEqual([
      {
        from: path.join(libvipsDir, `lib`, `libvips-cpp.so.8.18.7`),
        to: path.join(
          outputDir,
          `sharp-libvips-linux-x64`,
          `lib`,
          `libvips-cpp.so.8.18.7`
        ),
      },
    ])
  })

  it(`skips binaries for other platforms, architectures and libc`, () => {
    for (const platformAndArch of [`linuxmusl-x64`, `linux-arm64`]) {
      const sharpDir = writePackage(`sharp-${platformAndArch}`, [
        `lib/sharp-${platformAndArch}-0.35.5.node`,
      ])
      writePackage(
        `sharp-libvips-${platformAndArch}`,
        [`lib/index.js`, `lib/libvips-cpp.so.8.18.7`],
        { "./lib": `./lib/index.js` }
      )

      expect(
        getSharpSharedLibraries(
          path.join(sharpDir, `lib`, `sharp-${platformAndArch}-0.35.5.node`),
          path.join(
            outputDir,
            `assets`,
            `lib`,
            `sharp-${platformAndArch}-0.35.5.node`
          ),
          `linux-x64`
        )
      ).toEqual([])
    }
  })

  it(`copies libraries that sit next to the binary`, () => {
    const sharpDir = writePackage(`sharp-win32-x64`, [
      `lib/sharp-win32-x64-0.35.5.node`,
      `lib/libvips-42.dll`,
      `lib/libvips-cpp-8.18.7.dll`,
    ])

    expect(
      getSharpSharedLibraries(
        path.join(sharpDir, `lib`, `sharp-win32-x64-0.35.5.node`),
        path.join(outputDir, `assets`, `lib`, `sharp-win32-x64-0.35.5.node`),
        `win32-x64`
      ).sort((a, b) => a.from.localeCompare(b.from))
    ).toEqual([
      {
        from: path.join(sharpDir, `lib`, `libvips-42.dll`),
        to: path.join(outputDir, `assets`, `lib`, `libvips-42.dll`),
      },
      {
        from: path.join(sharpDir, `lib`, `libvips-cpp-8.18.7.dll`),
        to: path.join(outputDir, `assets`, `lib`, `libvips-cpp-8.18.7.dll`),
      },
    ])
  })

  it(`returns nothing more when the libvips package is not installed`, () => {
    const sharpDir = writePackage(`sharp-darwin-arm64`, [
      `lib/sharp-darwin-arm64-0.35.5.node`,
    ])

    expect(
      getSharpSharedLibraries(
        path.join(sharpDir, `lib`, `sharp-darwin-arm64-0.35.5.node`),
        path.join(outputDir, `assets`, `lib`, `sharp-darwin-arm64-0.35.5.node`),
        `darwin-arm64`
      )
    ).toEqual([])
  })
})
