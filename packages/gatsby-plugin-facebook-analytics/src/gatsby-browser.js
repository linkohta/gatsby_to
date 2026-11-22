export const onRouteUpdate = () => {
  // 開発中はトラッキングしない。
  if (process.env.NODE_ENV === `production` && typeof FB === `function`) {
    window.FB.AppEvents.logPageView()
  }
}
