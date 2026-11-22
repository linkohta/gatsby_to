import colors from "ansi-colors"

// gatsby-cli 全体には依存したくないので、reporter は使えない
export const reporter = {
  info: (message: string): void => console.log(message),
  verbose: (message: string): void => console.log(message),
  log: (message: string): void => console.log(message),
  success: (message: string): void =>
    console.log(colors.green(colors.symbols.check + ` `) + message),
  error: (message: string): void =>
    console.error(colors.red(colors.symbols.cross + ` `) + message),
  panic: (message: string): never => {
    console.error(message)
    process.exit(1)
  },
  warn: (message: string): void => console.warn(colors.yellow(message)),
}
