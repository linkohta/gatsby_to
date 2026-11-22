import { Helmet } from "react-helmet"

export const onRenderBody = ({
  setHeadComponents,
  setHtmlAttributes,
  setBodyAttributes,
}) => {
  const helmet = Helmet.renderStatic()
  // これらのアクション関数は、Gatsby 1.x の途中で追加された。
  if (setHtmlAttributes) {
    setHtmlAttributes(helmet.htmlAttributes.toComponent())
  }
  if (setBodyAttributes) {
    setBodyAttributes(helmet.bodyAttributes.toComponent())
  }

  const components = [
    helmet.link.toComponent(),
    helmet.meta.toComponent(),
    helmet.noscript.toComponent(),
    helmet.script.toComponent(),
    helmet.style.toComponent(),
    helmet.base.toComponent(),
  ]

  const titleComponent = helmet.title.toComponent()

  setHeadComponents(
    titleComponent?.[0]?.props?.children
      ? [titleComponent, ...components]
      : components
  )
}
