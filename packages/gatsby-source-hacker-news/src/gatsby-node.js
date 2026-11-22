const axios = require(`axios`)
const url = require(`url`)
const _ = require(`lodash`)

const get = query =>
  axios.get(
    `https://www.graphqlhub.com/graphql?query=${encodeURIComponent(query)}`
  )

exports.createSchemaCustomization = async ({ actions }) => {
  const typeDefs = `
    type HNComment implements Node @childOf(types: ["HNStory", "HNComment"], many: true) {
      text: String
      timeISO: Date! @dateformat
      by: String!
      order: Int!
    }

    type HNStory implements Node {
      title: String
      score: Int
      timeISO: Date! @dateformat
      url: String
      by: String!
      descendants: Int
      content: String!
      domain: String
      order: Int!
    }
  `
  actions.createTypes(typeDefs)
}

exports.sourceNodes = async ({
  actions,
  getNode,
  createNodeId,
  createContentDigest,
}) => {
  const { createNode } = actions

  // 最初の取得を行う
  console.time(`fetch HN data`)
  console.log(
    `starting to fetch data from the Hacker News GraphQL API. Warning, this can take a long time e.g. 10-20 seconds`
  )
  const result = await get(
    `
{
  hn {
    topStories(limit: 30) {
      id
      title
      score
      timeISO
      url
      by {
        id
      }
      descendants
      kids {
        ...commentsFragment
        kids {
          ...commentsFragment
          kids {
            ...commentsFragment
            kids {
              ...commentsFragment
              kids {
                ...commentsFragment
                kids {
                  ...commentsFragment
                  kids {
                    ...commentsFragment
                    kids {
                      ...commentsFragment
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

fragment commentsFragment on HackerNewsItem {
  id
  text
  timeISO
  by {
    id
  }
}
  `
  )
  console.timeEnd(`fetch HN data`)

  // トップストーリーのノードを作成する。
  result.data.data.hn.topStories.forEach((story, i) => {
    const storyStr = JSON.stringify(story)

    // Ask HN や投票などには URL がない。
    // URL があるものについては、HN はドメインだけを表示する。
    let domain
    if (story.url) {
      const parsedUrl = url.parse(story.url)
      const splitHost = parsedUrl.host.split(`.`)
      if (splitHost.length > 2) {
        domain = splitHost.slice(1).join(`.`)
      } else {
        domain = splitHost.join(`.`)
      }
    }

    const kids = _.pick(story, `kids`)
    if (!kids.kids) {
      kids.kids = []
    }
    const kidLessStory = _.omit(story, `kids`)
    const childIds = kids.kids.filter(Boolean).map(k => createNodeId(k.id))

    const storyNode = {
      ...kidLessStory,
      id: createNodeId(kidLessStory.id),
      children: childIds,
      parent: null,
      content: storyStr,
      internal: {
        type: `HNStory`,
      },
      domain,
      order: i + 1,
    }

    // ユーザー id だけを保存する
    storyNode.by = storyNode.by.id

    // ノードのコンテンツダイジェストを取得する。
    const contentDigest = createContentDigest(storyNode)
    storyNode.internal.contentDigest = contentDigest
    createNode(storyNode)

    // コメントのノードを再帰的に作成する。
    const createCommentNodes = (comments, parent, depth = 0) => {
      comments.forEach((comment, i) => {
        if (!comment) {
          return
        }
        if (!comment.kids) {
          comment.kids = []
        }
        const commentChildIds = comment.kids.map(k => createNodeId(k.id))
        const commentNode = {
          ..._.omit(comment, `kids`),
          id: createNodeId(comment.id),
          children: commentChildIds,
          parent,
          internal: {
            type: `HNComment`,
          },
          order: i + 1,
        }

        commentNode.by = commentNode.by.id
        const nodeStr = JSON.stringify(commentNode)

        // コメントのノードのコンテンツダイジェストを取得する。
        const contentDigest = createContentDigest(nodeStr)
        commentNode.internal.contentDigest = contentDigest
        commentNode.internal.content = nodeStr

        createNode(commentNode)

        if (comment.kids.length > 0) {
          createCommentNodes(comment.kids, commentNode.id, depth + 1)
        }
      })
    }

    createCommentNodes(kids.kids, storyNode.id)
  })

  return
}
