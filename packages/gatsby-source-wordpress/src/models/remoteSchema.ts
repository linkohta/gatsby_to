/* eslint-disable @typescript-eslint/no-explicit-any */
import { createModel } from "@rematch/core"
import { findNamedTypeName } from "~/steps/create-schema-customization/helpers"
import { IRootModel } from "."

const remoteSchema = createModel<IRootModel>()({
  state: {
    wpUrl: null,
    nodeQueries: {},
    nonNodeQuery: null,
    introspectionData: null,
    schemaWasChanged: null,
    typeMap: null,
    nodeListFilter: (field: { name: string }): boolean =>
      field.name === `nodes`,
    ingestibles: {
      nodeListRootFields: null,
      nodeInterfaceTypes: null,
      nonNodeRootFields: [],
    },
    allowRefreshSchemaUpdate: false,
    fetchedTypes: new Map(),
    fieldBlacklist: [
      `isWpGatsby`,
      `edges`,
      // これらは認証がないと役に立たない
      `revisions`,
      `isJwtAuthSecretRevoked`,
      `isRestricted`,
      `jwtAuthExpiration`,
      `jwtAuthToken`,
      `jwtRefreshToken`,
      `jwtUserSecret`,
      `editLock`,
      `revisionOf`,
      `preview`,
      `isPreview`,
      `previewRevisionDatabaseId`,
      `previewRevisionId`,
      `editingLockedBy`,
      `cursor`,
    ],
    // @todo これをプラグインオプションにする
    fieldAliases: {
      parent: `wpParent`,
      children: `wpChildren`,
      internal: `wpInternal`,
      plugin: `wpPlugin`,
      actionOptions: `wpActionOptions`,
      fields: `wpFields`,
    },
  },

  reducers: {
    toggleAllowRefreshSchemaUpdate(state) {
      state.allowRefreshSchemaUpdate = !state.allowRefreshSchemaUpdate

      return state
    },

    setSchemaWasChanged(state, payload) {
      state.schemaWasChanged = !!payload

      return state
    },

    addFieldsToBlackList(state, payload) {
      state.fieldBlacklist = [...state.fieldBlacklist, ...payload]
      return state
    },

    setState(state, payload) {
      state = {
        ...state,
        ...payload,
      }

      return state
    },

    addFetchedType(state, type) {
      const key = findNamedTypeName(type)

      if (!key) {
        return state
      }

      type = state.typeMap.get(key)

      // メンバー型のないユニオン型は、スキーマのカスタマイズでエラーの原因になる
      // @todo これをもっと適切な場所へ移す。ここに到達する前に除外されているべきである。
      if (type && type.kind === `UNION` && type.possibleTypes.length === 0) {
        return state
      }

      state.fetchedTypes.set(key, type)

      return state
    },
  },
  effects: () => {
    return {}
  },
})

export default remoteSchema
