/* global __MANIFEST_PLUGIN_HAS_LOCALISATION__ */
import { withPrefix } from "gatsby"
import getManifestForPathname from "./get-manifest-pathname"

// manifest にローカライズがない場合は、ツリーシェイキングですべて取り除く
export const onRouteUpdate = function onRouteUpdate(
  { location },
  pluginOptions
) {
  if (__MANIFEST_PLUGIN_HAS_LOCALISATION__) {
    const { localize } = pluginOptions
    const manifestFilename = getManifestForPathname(
      location.pathname,
      localize,
      true
    )

    const manifestEl = document.head.querySelector(`link[rel="manifest"]`)
    if (manifestEl) {
      manifestEl.setAttribute(`href`, withPrefix(manifestFilename))
    }
  }
}
