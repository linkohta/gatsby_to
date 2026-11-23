/**
 * @jest-environment jsdom
 */

import { onInitialClientRender, onRouteUpdate } from "../gatsby-browser"
import { Minimatch } from "minimatch"
import { onLCP, onINP, onCLS } from "web-vitals"

jest.mock(`web-vitals`, () => {
  function createEntry(type, id, value) {
    return { name: type, id, value }
  }

  return {
    onLCP: jest.fn(report => {
      report(createEntry(`LCP`, `1`, `300`))
    }),
    onINP: jest.fn(report => {
      report(createEntry(`INP`, `2`, `150`))
    }),
    onCLS: jest.fn(report => {
      report(createEntry(`CLS`, `3`, `0.10`))
    }),
  }
})

describe(`gatsby-plugin-google-analytics`, () => {
  describe(`gatsby-browser`, () => {
    describe(`onRouteUpdate`, () => {
      describe(`in non-production env`, () => {
        it(`does not send page view`, () => {
          window.ga = jest.fn()

          onRouteUpdate({})

          expect(window.ga).not.toHaveBeenCalled()
        })
      })

      describe(`in production env`, () => {
        let env

        beforeAll(() => {
          env = process.env.NODE_ENV
          process.env.NODE_ENV = `production`
        })

        afterAll(() => {
          process.env.NODE_ENV = env
        })

        beforeEach(() => {
          jest.useFakeTimers({ legacyFakeTimers: true })
          jest.clearAllMocks()
          window.ga = jest.fn()
        })

        afterEach(() => {
          jest.useRealTimers()
        })

        it(`does not send page view when ga is undefined`, () => {
          delete window.ga

          onRouteUpdate({})

          jest.runAllTimers()

          expect(setTimeout).not.toHaveBeenCalled()
        })

        it(`does not send page view when path is excluded`, () => {
          const mm = new Minimatch(`/test-pages/**`)
          window.excludeGAPaths = [mm.makeRe()]

          onRouteUpdate({
            location: {
              pathname: `/test-pages/example`,
            },
          })

          jest.runAllTimers()

          expect(window.ga).not.toHaveBeenCalled()
        })

        it(`sends page view`, () => {
          onRouteUpdate({})

          jest.runAllTimers()

          expect(window.ga).toHaveBeenCalledTimes(2)
        })

        it(`uses setTimeout with a minimum delay of 32ms`, () => {
          onRouteUpdate({})

          jest.runAllTimers()

          expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 32)
          expect(window.ga).toHaveBeenCalledTimes(2)
        })

        it(`uses setTimeout with the provided pageTransitionDelay value`, () => {
          onRouteUpdate({}, { pageTransitionDelay: 1000 })

          jest.runAllTimers()

          expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000)
          expect(window.ga).toHaveBeenCalledTimes(2)
        })

        it(`sends core web vitals when enabled`, async () => {
          onInitialClientRender({}, { enableWebVitalsTracking: true })

          // 動的 import の解決を待つため、2 ティック待つ
          await Promise.resolve()
          await Promise.resolve()

          jest.runAllTimers()

          expect(window.ga).toHaveBeenCalledTimes(3)
          expect(window.ga).toHaveBeenCalledWith(
            `send`,
            `event`,
            expect.objectContaining({
              eventAction: `LCP`,
              eventCategory: `Web Vitals`,
              eventLabel: `1`,
              eventValue: 300,
            })
          )
          expect(window.ga).toHaveBeenCalledWith(
            `send`,
            `event`,
            expect.objectContaining({
              eventAction: `INP`,
              eventCategory: `Web Vitals`,
              eventLabel: `2`,
              eventValue: 150,
            })
          )
          expect(window.ga).toHaveBeenCalledWith(
            `send`,
            `event`,
            expect.objectContaining({
              eventAction: `CLS`,
              eventCategory: `Web Vitals`,
              eventLabel: `3`,
              eventValue: 100,
            })
          )
        })

        it(`sends nothing when web vitals tracking is disabled`, async () => {
          onInitialClientRender({}, { enableWebVitalsTracking: false })

          // 動的 import の解決を待つため、2 ティック待つ
          await Promise.resolve()
          await Promise.resolve()

          jest.runAllTimers()

          expect(onLCP).not.toHaveBeenCalled()
          expect(onINP).not.toHaveBeenCalled()
          expect(onCLS).not.toHaveBeenCalled()
        })
      })
    })
  })
})
