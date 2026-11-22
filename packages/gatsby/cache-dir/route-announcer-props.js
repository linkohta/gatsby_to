// ブラウザーと SSR のコードで共有するため、
// 別モジュールに切り出している
export const RouteAnnouncerProps = {
  id: `gatsby-announcer`,
  style: {
    position: `absolute`,
    top: 0,
    width: 1,
    height: 1,
    padding: 0,
    overflow: `hidden`,
    clip: `rect(0, 0, 0, 0)`,
    whiteSpace: `nowrap`,
    border: 0,
  },
  "aria-live": `assertive`,
  "aria-atomic": `true`,
}
