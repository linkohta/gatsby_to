/**
 * @jest-environment jsdom
 */

const { onServiceWorkerActive } = require(`../gatsby-browser`)

it(`does not add prefetch for preconnect/prefetch/prerender`, () => {
  const addHeadElement = (tagName, attributes) => {
    const el = document.createElement(tagName)
    for (const key in attributes) {
      el.setAttribute(key, attributes[key])
    }
    document.head.appendChild(el)
    return el
  }

  // prefetch されないこと
  addHeadElement(`link`, { rel: `preconnect`, href: `https://gatsbyjs.com` })
  addHeadElement(`link`, { rel: `prefetch`, href: `https://gatsbyjs.com` })
  addHeadElement(`link`, { rel: `prerender`, href: `https://gatsbyjs.com` })
  addHeadElement(`script`, { src: `https://gats.by/script.js` })
  addHeadElement(`style`, { "data-href": `https://gats.by/lazy.css` })
  addHeadElement(`link`, {
    rel: `stylesheet`,
    href: `https://gats.by/style.css`,
  })
  addHeadElement(`link`, {
    rel: `preconnect dns-prefetch`,
    href: `https://www.google-analytics.com`,
  })

  onServiceWorkerActive({
    getResourceURLsForPathname: () => [],
    serviceWorker: { active: {} },
  })

  // 最初の 5 つの link 要素は、上で追加した実際のリソースであること
  // 残りの link 要素は、gatsby-browser が prefetch として追加したものであること
  const links = [].slice.call(document.querySelectorAll(`head > link`))

  // スタイルシート、スクリプト、遅延読み込みされるスタイルに prefetch を追加すること
  expect(links[5].href).toBe(`https://gats.by/script.js`)
  expect(links[5].rel).toBe(`prefetch`)
  expect(links[6].href).toBe(`https://gats.by/lazy.css`)
  expect(links[6].rel).toBe(`prefetch`)
  expect(links[7].href).toBe(`https://gats.by/style.css`)
  expect(links[7].rel).toBe(`prefetch`)
})
