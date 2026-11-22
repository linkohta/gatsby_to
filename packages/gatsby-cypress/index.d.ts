declare global {
  namespace Cypress {
    interface Chainable<Subject = any> {
      /**
       * イベントハンドラーが正しく設定されるよう、Gatsby がルートの変更を終えるまで待つ
       * @example
       * cy.visit(`/page-2`).waitForRouteChange()
       */
      waitForRouteChange: () => Chainable<Subject>
      /**
       * 指定した Gatsby の API が終わるまで待つ
       * @example
       * cy.waitForAPI(`onRouteUpdate`).get(`#element-with-event-handler`).click()
       */
      waitForAPI: (lifeCycleName: string) => Chainable<Subject>
      /**
       * 指定した Gatsby の API が終わるまで待つ。終わらない場合はタイムアウトする。
       * @example
       * cy.waitForAPIorTimeout(`onRouteUpdate`)
       */
      waitForAPIorTimeout: (lifeCycleName: string, options?: WaitForApiOrTimeoutOptions) => Chainable<Subject>
    }
  }
}

export interface WaitForApiOrTimeoutOptions {
  timeout?: number
}

export {}