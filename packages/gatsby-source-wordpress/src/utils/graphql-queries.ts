/**
 * 更新が 1 つでもあったかを確認するために使う。gatsby develop では、アクションが 1 つあれば再取得が始まる
 */
export const contentPollingQuery = /* GraphQL */ `
  query GET_SINGLE_ACTION_MONITOR_ACTION($since: Float!) {
    actionMonitorActions(where: { sinceTimestamp: $since }, first: 1) {
      nodes {
        id
      }
    }
  }
`

/**
 * ある unix タイムスタンプ以降の WP の変更を取得するために使う
 * これによりデータを差分で取得できる
 */
export const actionMonitorQuery = /* GraphQL */ `
  query GET_ACTION_MONITOR_ACTIONS($since: Float!, $after: String) {
    actionMonitorActions(
      where: {
        sinceTimestamp: $since
        orderby: { field: MODIFIED, order: DESC }
      }
      first: 100
      after: $after
    ) {
      nodes {
        id
        title
        actionType
        referencedNodeID
        referencedNodeStatus
        referencedNodeGlobalRelayID
        referencedNodeSingularName
        referencedNodePluralName
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

export const introspectionQuery = /* GraphQL */ `
  {
    __schema {
      types {
        kind
        name
        description

        possibleTypes {
          kind
          name
        }
        interfaces {
          kind
          name
        }
        enumValues {
          name
        }
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
        # there might be interface in remote schema that seems to not deprecate the field
        # but types implementing interface do deprecate the field
        # and without asking to include deprecated - following errors happens
        # Error: Interface field WpAcfPageFieldsFlexibleContentField_Layout.fieldGroupName
        # expected but WpAcfPageFieldsFlexibleContentFieldFlexLayout1Layout_Fields does
        # not provide it.
        fields(includeDeprecated: true) {
          name
          description
          args {
            name
            type {
              kind
              name
              inputFields {
                name
              }
            }
          }
          type {
            name
            kind
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }

      mutationType {
        fields {
          type {
            name
          }
        }
      }
    }
  }
`
