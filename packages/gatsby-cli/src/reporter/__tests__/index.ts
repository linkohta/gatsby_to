import { Level } from "../../structured-errors/types"
import { reporter } from "../reporter"
import * as reporterActions from "../redux/actions"

// TODO: 現在の report.error は値を返す。このスパイとモックの仕組みをなくす

// report.error は何も返さない。`structuredError` オブジェクトを作成して
// reporterInstance.error(structuredError) を呼び出す

// reporterInstance.error をスパイし、structuredError を返すように
// 実装をモックする

// こうすれば、返された structuredError をスナップショットに使える。
jest
  .spyOn(reporterActions, `createLog`)
  // @ts-ignore
  .mockImplementation(structuredLog => structuredLog)

// これは対象外である
reporter.log = jest.fn()

const getErrorMessages = (fn: jest.Mock): any =>
  fn.mock.calls
    .map(([firstArg]) => firstArg)
    .filter(structuredMessage => structuredMessage.level === `ERROR`)

describe(`report.error`, () => {
  beforeEach(() => {
    ;(reporterActions.createLog as jest.Mock).mockClear()
  })

  it(`handles "String, Error" signature correctly`, () => {
    reporter.error(
      `Error string passed to reporter`,
      new Error(`Message from new Error`)
    )
    const generatedError = getErrorMessages(
      reporterActions.createLog as jest.Mock
    )[0]

    expect(generatedError).toMatchSnapshot({
      stack: expect.any(Array),
    })
  })

  it(`handles "Error" signature correctly`, () => {
    reporter.error(new Error(`Message from new Error`))
    const generatedError = getErrorMessages(
      reporterActions.createLog as jest.Mock
    )[0]
    expect(generatedError).toMatchSnapshot({
      stack: expect.any(Array),
    })
  })

  it(`handles "Array of Errors" signature correctly`, () => {
    reporter.error([
      new Error(`Message 1 from new Error`),
      new Error(`Message 2 from new Error`),
      new Error(`Message 3 from new Error`),
    ])

    const generatedErrors = getErrorMessages(
      reporterActions.createLog as jest.Mock
    )

    expect(generatedErrors.length).toEqual(3)

    // 最終的に生成されたオブジェクトを取得する
    const generatedError = generatedErrors[2]
    expect(generatedError).toMatchSnapshot({
      stack: expect.any(Array),
    })
  })

  it(`handles "structuredError" signature correctly`, () => {
    reporter.error({
      id: `95312`,
      context: {
        undefinedGlobal: `navigator`,
      },
    })
    const generatedError = getErrorMessages(
      reporterActions.createLog as jest.Mock
    )[0]
    expect(generatedError).toMatchSnapshot({
      stack: expect.any(Array),
    })
  })

  it(`handles "String" signature correctly`, () => {
    reporter.error(`Error created in Jest`)
    const generatedError = getErrorMessages(
      reporterActions.createLog as jest.Mock
    )[0]
    expect(generatedError).toMatchSnapshot({
      stack: expect.any(Array),
    })
  })

  it(`handles "String, Error, pluginName" signature correctly`, () => {
    reporter.error(
      `Error string passed to reporter`,
      new Error(`Message from new Error`),
      `gatsby-plugin-foo-bar`
    )
    const generatedError = getErrorMessages(
      reporterActions.createLog as jest.Mock
    )[0]
    expect(generatedError).toMatchSnapshot({
      stack: expect.any(Array),
    })
  })

  it(`sets an error map if setErrorMap is called`, () => {
    reporter.setErrorMap({
      "1337": {
        text: (context): string => `Error text is ${context.someProp}`,
        level: Level.ERROR,
        docsUrl: `https://www.gatsbyjs.com/docs/gatsby-cli/#new`,
      },
    })

    expect(reporter.errorMap[`1337`]).toBeTruthy()
  })

  it(`uses custom error from errorMap`, () => {
    reporter.setErrorMap({
      "1337": {
        text: (context): string => `Error text is ${context.someProp}`,
        level: Level.ERROR,
        docsUrl: `https://www.gatsbyjs.com/docs/gatsby-cli/#new`,
      },
    })

    reporter.error({
      id: `1337`,
      context: {
        someProp: `test123`,
      },
    })
    const generatedError = getErrorMessages(
      reporterActions.createLog as jest.Mock
    )[0]
    expect(generatedError).toMatchSnapshot({
      stack: expect.any(Array),
    })
  })

  // api-runner-node.js からは、このように呼び出される可能性がある
  // errorMap に接頭辞を付け、第 3 引数として pluginName を渡す
  it(`uses custom error from errorMap with pluginName`, () => {
    reporter.setErrorMap({
      "gatsby-plugin-foo-bar_1337": {
        text: (context): string => `Error text is ${context.someProp}`,
        level: Level.ERROR,
        docsUrl: `https://www.gatsbyjs.com/docs/gatsby-cli/#new`,
      },
    })

    reporter.error(
      {
        id: `1337`,
        context: {
          someProp: `test123`,
        },
      },
      undefined,
      `gatsby-plugin-foo-bar`
    )
    const generatedError = getErrorMessages(
      reporterActions.createLog as jest.Mock
    )[0]
    expect(generatedError).toMatchSnapshot({
      stack: expect.any(Array),
    })
  })
})
