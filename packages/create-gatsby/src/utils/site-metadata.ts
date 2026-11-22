export async function setSiteMetadata(
  root: string,
  name: string,
  value: string
): Promise<void> {
  try {
    const coreUtilsPath = require.resolve(`gatsby-core-utils`, {
      paths: [root],
    })
    const { addFieldToMinimalSiteMetadata } = require(coreUtilsPath)
    await addFieldToMinimalSiteMetadata({ root }, { name, value })
  } catch (e) {
    // 何もせずに失敗させる。設定に追加できなくても問題ないため
  }
}
