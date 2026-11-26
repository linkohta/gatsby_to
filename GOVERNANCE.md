# ガバナンス

このリポジトリは [gatsbyjs/gatsby](https://github.com/gatsbyjs/gatsby) のフォークで、リポジトリの所有者（[@linkohta](https://github.com/linkohta)）が本家とは別に保守しています。本家の[ガバナンスモデル](https://www.gatsbyjs.com/contributing/gatsby-governance-model/)は、このリポジトリには適用されません。

- 変更は、すべて Pull Request を通して `master` に取り込みます。マージするかどうかは、リポジトリの所有者が判断します。
- CI が失敗している Pull Request はマージしません。
- 開発ルールは [CLAUDE.md](./CLAUDE.md) にまとめています。影響の大きい変更（公開 API、対応する Node.js の下限、ビルドの土台になるツールなど）は、着手する前にリポジトリの所有者へ確認します。
- 本家の更新は取り込みません。
