import { getStore, createStore, asyncLocalStorage } from "../../../dist/store"
const store = { store: createStore(), key: `test` }

const withGlobalStore = fn => () => asyncLocalStorage.run(store, fn)
test(
  `Plugin options presets merge preset data into default and user data`,
  withGlobalStore(() => {
    getStore().dispatch.gatsbyApi.setState({
      pluginOptions: {
        url: `test.com`,
        type: {
          ExistingType: {
            limit: 3,
          },
          FakeType: {
            exclude: true,
          },
        },
        presets: [
          {
            presetName: `TEST_PRESET`,
            useIf: () => true,
            options: {
              type: {
                FakeType: {
                  exclude: false,
                  limit: 1,
                },
                ExistingType: {
                  limit: 2,
                },
              },
            },
          },
        ],
      },
      helpers: null,
    })

    const { pluginOptions } = getStore().getState().gatsbyApi

    // トップレベルのオプションがプリセットのオプションを上書きする
    expect(pluginOptions.type.ExistingType.limit).toBe(3)
    expect(pluginOptions.type.FakeType.exclude).toBe(true)

    // このオプションはトップレベルでは定義されていないが、プリセットに含まれている
    expect(pluginOptions.type.FakeType.limit).toBe(1)
  })
)
