import fetch, { Response } from "node-fetch"
import { HttpError } from "./errors"

const MAX_BACKOFF_MILLISECONDS = 60000

// TODO エラー（特に 500）を処理するロジックを更新し、createRestClient の
// 「強引な」コードも更新する

export function createGraphqlClient(
  options: IShopifyPluginOptions
): IGraphQLClient {
  const url = `https://${options.storeUrl}/admin/api/${options.apiVersion}/graphql.json`

  async function graphqlFetch<T>(
    query: string,
    variables?: Record<string, unknown>,
    retries = 0
  ): Promise<T> {
    const response = await fetch(url, {
      method: `POST`,
      headers: {
        "Content-Type": `application/json`,
        "X-Shopify-Access-Token": options.password,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    })

    if (!response.ok) {
      const waitTime = 2 ** (retries + 1) + 500
      if (response.status >= 500 && waitTime < MAX_BACKOFF_MILLISECONDS) {
        await new Promise(resolve => setTimeout(resolve, waitTime))
        return graphqlFetch(query, variables, retries + 1)
      }

      throw new HttpError(response)
    }

    const json = (await response.json()) as { data: T }
    return json.data
  }

  return { request: graphqlFetch }
}

export function createRestClient(options: IShopifyPluginOptions): IRestClient {
  const baseUrl = `https://${options.storeUrl}/admin/api/${options.apiVersion}`

  async function shopifyFetch(
    path: string,
    fetchOptions = {
      headers: {
        "X-Shopify-Access-Token": options.password,
      },
    },
    retries = 3
  ): Promise<Response> {
    /**
     * これはややハック的だが...
     *
     * こうしているのは、呼び出し元は相対パスを使う一方で、
     * レスポンスによってはページネーションのリンクが含まれ、次のページを
     * 取得するためにそれが shopifyFetch へ戻されることがあるためである。そのリンクは
     * 絶対 URL なので両方に対応しているが、あまり堅牢な方法では
     * ない。
     */
    const url = path.includes(options.storeUrl) ? path : `${baseUrl}${path}`

    const resp = await fetch(url, fetchOptions)

    if (!resp.ok && retries > 0 && resp.status === 429) {
      // レート制限
      const retryAfter = parseFloat(resp.headers.get(`Retry-After`) || ``)
      await new Promise(resolve => setTimeout(resolve, retryAfter))
      return shopifyFetch(path, fetchOptions, retries - 1)
    }

    return resp
  }

  return {
    request: async (path: string): Promise<Response> => shopifyFetch(path),
  }
}
